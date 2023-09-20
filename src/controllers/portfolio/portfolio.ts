import { JsonRpcProvider } from 'ethers'
import fetch from 'node-fetch'

import { Account, AccountId } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { AccountOp, isAccountOpsIntentEqual } from '../../libs/accountOp/accountOp'
import {
  AccountState,
  AdditionalAccountState,
  Hints,
  PortfolioControllerState,
  PortfolioGetResult
} from '../../libs/portfolio/interfaces'
import { GetOptions, Portfolio } from '../../libs/portfolio/portfolio'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import EventEmitter from '../eventEmitter'

export class PortfolioController extends EventEmitter {
  latest: PortfolioControllerState

  pending: PortfolioControllerState

  #portfolioLibs: Map<string, Portfolio>

  #storage: Storage

  #callRelayer: Function

  #pinned: string[]

  #minUpdateInterval: number = 20000 // 20 seconds

  constructor(storage: Storage, relayerUrl: string, pinned: string[]) {
    super()
    this.latest = {}
    this.pending = {}
    this.#portfolioLibs = new Map()
    this.#storage = storage
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.#pinned = pinned
  }

  async getAdditionalPortfolio(accountId: AccountId) {
    if (!this.latest[accountId]) this.latest[accountId] = {}
    const start = Date.now()

    const accountState = this.latest[accountId] as AdditionalAccountState
    if (!accountState?.gasTank) accountState.gasTank = { isReady: false, isLoading: true }
    if (!accountState?.rewards) accountState.rewards = { isReady: false, isLoading: true }

    accountState.rewards.isReady = false
    accountState.rewards.isLoading = true

    accountState.gasTank.isReady = false
    accountState.gasTank.isLoading = true
    this.emitUpdate()

    const url = `/v2/identity/${accountId}/info`
    try {
      const res = await this.#callRelayer(url)

      accountState.rewards = {
        isReady: true,
        isLoading: false,
        result: {
          ...res.data.rewards,
          updateStarted: start,
          tokens: [
            res.data.rewards.xWalletClaimableBalance || [],
            res.data.rewards.walletClaimableBalance || []
          ].flat(),
          total: [
            res.data.rewards.xWalletClaimableBalance || [],
            res.data.rewards.walletClaimableBalance || []
          ]
            .flat()
            .reduce((cur: any, token: any) => {
              for (const x of token.priceIn) {
                cur[x.baseCurrency] =
                  (cur[x.baseCurrency] || 0) +
                  (Number(token.amount) / 10 ** token.decimals) * x.price
              }

              return cur
            }, {})
        }
      }

      accountState.gasTank = {
        isReady: true,
        isLoading: false,
        result: {
          updateStarted: start,
          tokens: res.data.gasTank.balance,
          total: res.data.gasTank.balance
            ? res.data.gasTank.balance.reduce((cur: any, token: any) => {
                for (const x of token.priceIn) {
                  cur[x.baseCurrency] =
                    (cur[x.baseCurrency] || 0) +
                    (Number(token.amount) / 10 ** token.decimals) * x.price
                }
                return cur
              }, {})
            : 0
        }
      }

      this.emitUpdate()
      return
    } catch (e: any) {
      if (!accountState?.rewards) accountState.rewards = { isReady: false, isLoading: false }
      if (!accountState?.gasTank) accountState.gasTank = { isReady: false, isLoading: false }

      accountState.gasTank.isLoading = false
      accountState.rewards.isLoading = false

      if (!accountState.gasTank.isReady) accountState.gasTank.criticalError = e
      if (!accountState.rewards.isReady) accountState.rewards.criticalError = e
      else {
        accountState.gasTank.errors = [e]
        accountState.rewards.errors = [e]
      }
      this.emitUpdate()
      return false
    }
  }
  // NOTE: we always pass in all `accounts` and `networks` to ensure that the user of this
  // controller doesn't have to update this controller every time that those are updated

  // The recommended behavior of the application that this API encourages is:
  // 1) when the user selects an account, update it's portfolio on all networks (latest state only) by calling updateSelectedAccount
  // 2) every time the user has a change in their pending (to be signed or to be mined) bundle(s) on a
  // certain network, call updateSelectedAccount again with those bundles; it will update the portfolio balance
  // on each network where there are bundles, and it will update both `latest` and `pending` states on said networks
  // it will also use a high `priceRecency` to make sure we don't lose time in updating prices (since we care about running the simulations)

  // the purpose of this function is to call it when an account is selected or the queue of accountOps changes
  async updateSelectedAccount(
    accounts: Account[],
    networks: NetworkDescriptor[],
    accountId: AccountId,
    // network => AccountOp
    accountOps?: { [key: string]: AccountOp[] },
    opts?: {
      forceUpdate: boolean
    }
  ) {
    // Load storage cached hints
    const storagePreviousHints = await this.#storage.get('previousHints', {})

    const selectedAccount = accounts.find((x) => x.addr === accountId)
    if (!selectedAccount) throw new Error('selected account does not exist')

    const prepareState = (state: PortfolioControllerState): void => {
      if (!state[accountId]) state[accountId] = {}

      const accountState = state[accountId]
      for (const networkId of Object.keys(accountState)) {
        if (![...networks, { id: 'gasTank' }, { id: 'rewards' }].find((x) => x.id === networkId))
          delete accountState[networkId]
      }
      this.emitUpdate()
    }

    prepareState(this.latest)
    prepareState(this.pending)
    const accountState = this.latest[accountId]
    const pendingState = this.pending[accountId]

    const updatePortfolioState = async (
      accountState: AccountState,
      network: NetworkDescriptor,
      portfolioLib: Portfolio,
      portfolioProps: Partial<GetOptions>,
      forceUpdate: boolean
    ): Promise<boolean> => {
      if (!accountState[network.id]) {
        accountState[network.id] = { isReady: false, isLoading: false }
        this.emitUpdate()
      }

      const state = accountState[network.id]!

      // When the portfolio was called lastly
      const lastUpdateStartedAt = state.result?.updateStarted
      if (
        lastUpdateStartedAt &&
        Date.now() - lastUpdateStartedAt <= this.#minUpdateInterval &&
        !forceUpdate
      )
        return false

      // Only one loading at a time, ensure there are no race conditions
      if (state.isLoading && !forceUpdate) return false

      state.isLoading = true
      this.emitUpdate()

      try {
        const result = await portfolioLib.get(accountId, {
          priceRecency: 60000,
          priceCache: state.result?.priceCache,
          ...portfolioProps
        })
        accountState[network.id] = { isReady: true, isLoading: false, result }
        this.emitUpdate()
        return true
      } catch (e: any) {
        state.isLoading = false
        if (!state.isReady) state.criticalError = e
        else state.errors = [e]
        this.emitUpdate()
        return false
      }
    }

    await Promise.all(
      networks.map(async (network) => {
        const key = `${network.id}:${accountId}`
        if (!this.#portfolioLibs.has(key)) {
          const provider = new JsonRpcProvider(network.rpcUrl)
          this.#portfolioLibs.set(key, new Portfolio(fetch, provider, network))
        }
        const portfolioLib = this.#portfolioLibs.get(key)!

        const currentAccountOps = accountOps?.[network.id]
        const simulatedAccountOps = pendingState[network.id]?.accountOps

        // We are performing the following extended check because both (or one of both) variables may have an undefined value.
        // If both variables contain AccountOps, we can simply compare for changes in the AccountOps intent.
        // However, when one of the variables is not set, two cases arise:
        // 1. A change occurs if one variable is undefined and the other one holds an AccountOps object.
        // 2. No change occurs if both variables are undefined.
        const areAccountOpsChanged =
          currentAccountOps && simulatedAccountOps
            ? !isAccountOpsIntentEqual(currentAccountOps, simulatedAccountOps)
            : currentAccountOps !== simulatedAccountOps

        const forceUpdate = opts?.forceUpdate || areAccountOpsChanged

        const [isSuccessfulLatestUpdate, isSuccessfulPendingUpdate] = await Promise.all([
          // Latest state update
          updatePortfolioState(
            accountState,
            network,
            portfolioLib,
            {
              blockTag: 'latest',
              previousHints: storagePreviousHints[key],
              pinned: this.#pinned
            },
            forceUpdate
          ),
          // Pending state update
          // We are updating the pending state, only if AccountOps are changed or the application logic requests a force update
          forceUpdate
            ? await updatePortfolioState(
                pendingState,
                network,
                portfolioLib,
                {
                  blockTag: 'pending',
                  previousHints: storagePreviousHints[key],
                  ...(currentAccountOps && {
                    simulation: {
                      account: selectedAccount,
                      accountOps: currentAccountOps
                    }
                  }),
                  pinned: this.#pinned
                },
                forceUpdate
              )
            : Promise.resolve(false)
        ])

        // Persist previousHints in the disk storage for further requests, when:
        // latest state was updated successful and hints were fetched successful too (no hintsError from portfolio result)
        if (isSuccessfulLatestUpdate && !accountState[network.id]!.result!.hintsError) {
          storagePreviousHints[key] = getHintsWithBalance(accountState[network.id]!.result!)
          await this.#storage.set('previousHints', storagePreviousHints)
        }

        // We cache the previously simulated AccountOps
        // in order to compare them with the newly passed AccountOps before executing a new updatePortfolioState.
        // This allows us to identify any differences between the two.
        if (isSuccessfulPendingUpdate && currentAccountOps) {
          pendingState[network.id]!.accountOps = currentAccountOps
        }
      })
    )

    // console.log({ latest: this.latest, pending: this.pending })
  }
}

// We already know that `results.tokens` and `result.collections` tokens have a balance (this is handled by the portfolio lib).
// Based on that, we can easily find out which hint tokens also have a balance.
function getHintsWithBalance(result: PortfolioGetResult): {
  erc20s: Hints['erc20s']
  erc721s: Hints['erc721s']
} {
  const erc20s = result.tokens.map((token) => token.address)

  const erc721s = Object.fromEntries(
    result.collections.map((collection) => [
      collection.address,
      result.hints.erc721s[collection.address]
    ])
  )

  return {
    erc20s,
    erc721s
  }
}
