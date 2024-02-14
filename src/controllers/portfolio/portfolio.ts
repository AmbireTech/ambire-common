/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-param-reassign */
import fetch from 'node-fetch'

import { Account, AccountId } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { RPCProviders } from '../../interfaces/settings'
import { Storage } from '../../interfaces/storage'
import { isSmartAccount } from '../../libs/account/account'
import { AccountOp, isAccountOpsIntentEqual } from '../../libs/accountOp/accountOp'
import getAccountNetworksWithAssets from '../../libs/portfolio/getNetworksWithAssets'
import { getFlags } from '../../libs/portfolio/helpers'
import {
  AccountState,
  AdditionalAccountState,
  GetOptions,
  Hints,
  PinnedTokens,
  PortfolioControllerState,
  PortfolioGetResult,
  TokenResult
} from '../../libs/portfolio/interfaces'
import { Portfolio } from '../../libs/portfolio/portfolio'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import EventEmitter from '../eventEmitter/eventEmitter'

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

export class PortfolioController extends EventEmitter {
  latest: PortfolioControllerState

  pending: PortfolioControllerState

  #portfolioLibs: Map<string, Portfolio>

  #storage: Storage

  #providers: RPCProviders = {}

  #callRelayer: Function

  #pinned: PinnedTokens

  #networksWithAssetsByAccounts: {
    [accountId: string]: NetworkDescriptor['id'][]
  } = {}

  #minUpdateInterval: number = 20000 // 20 seconds

  constructor(storage: Storage, providers: RPCProviders, relayerUrl: string, pinned: PinnedTokens) {
    super()
    this.latest = {}
    this.pending = {}
    this.#providers = providers
    this.#portfolioLibs = new Map()
    this.#storage = storage
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.#pinned = pinned
  }

  async #updateNetworksWithAssets(
    accounts: Account[],
    accountId: AccountId,
    accountState: AccountState
  ) {
    const storageStateByAccount = await this.#storage.get('networksWithAssetsByAccount', {})

    // On the first run
    if (Object.keys(this.#networksWithAssetsByAccounts).length === 0) {
      // Remove old accounts from storage
      const storageAccounts = Object.keys(storageStateByAccount)
      const currentAccounts = accounts.map(({ addr }) => addr)
      const accountsToRemove = storageAccounts.filter((x) => !currentAccounts.includes(x))

      for (const account of accountsToRemove) {
        delete storageStateByAccount[account]
      }

      // Set the initial state
      this.#networksWithAssetsByAccounts = storageStateByAccount
    }

    this.#networksWithAssetsByAccounts[accountId] = getAccountNetworksWithAssets(
      accountId,
      accountState,
      storageStateByAccount,
      this.#providers
    )

    this.emitUpdate()
    await this.#storage.set('networksWithAssetsByAccount', this.#networksWithAssetsByAccounts)
  }

  get networksWithAssets() {
    return [...new Set(Object.values(this.#networksWithAssetsByAccounts).flat())]
  }

  // gets additional portfolio state from the relayer that isn't retrieved from the portfolio library
  // that's usually the two additional virtual networks: getTank and rewards
  #setNetworkLoading(accountId: AccountId, network: string, isLoading: boolean, error?: any) {
    const accountState = this.latest[accountId] as AdditionalAccountState
    if (!accountState[network]) accountState[network] = { errors: [], isReady: false, isLoading }
    accountState[network]!.isLoading = isLoading
    if (!error) {
      if (!accountState[network]!.isReady) accountState[network]!.criticalError = error
      else accountState[network]!.errors.push(error)
    }
  }

  async getAdditionalPortfolio(accountId: AccountId) {
    if (!this.latest[accountId]) this.latest[accountId] = {}
    const start = Date.now()
    const accountState = this.latest[accountId] as AdditionalAccountState

    this.#setNetworkLoading(accountId, 'gasTank', true)
    this.#setNetworkLoading(accountId, 'rewards', true)
    this.emitUpdate()

    let res: any
    try {
      res = await this.#callRelayer(`/v2/identity/${accountId}/portfolio-additional`)
    } catch (e: any) {
      console.error('relayer error for portfolio additional')
      this.#setNetworkLoading(accountId, 'gasTank', false, e)
      this.#setNetworkLoading(accountId, 'rewards', false, e)
      this.emitUpdate()
      return
    }

    if (!res) throw new Error('portfolio controller: no res, should never happen')

    const getTotal = (t: any[]) =>
      t.reduce((cur: any, token: any) => {
        for (const x of token.priceIn) {
          cur[x.baseCurrency] =
            (cur[x.baseCurrency] || 0) + (Number(token.amount) / 10 ** token.decimals) * x.price
        }

        return cur
      }, {})

    const rewardsTokens = [
      res.data.rewards.xWalletClaimableBalance || [],
      res.data.rewards.walletClaimableBalance || []
    ]
      .flat()
      .map((t: any) => ({
        ...t,
        flags: getFlags(res.data.rewards, 'rewards', t.networkId, t.address)
      }))
    accountState.rewards = {
      isReady: true,
      isLoading: false,
      errors: [],
      result: {
        ...res.data.rewards,
        updateStarted: start,
        tokens: rewardsTokens,
        total: getTotal(rewardsTokens)
      }
    }

    const gasTankTokens = res.data.gasTank.balance.map((t: any) => ({
      ...t,
      flags: getFlags(res.data, 'gasTank', t.networkId, t.address)
    }))

    let pinnedGasTankTokens: TokenResult[] = []

    if (res.data.gasTank.availableGasTankAssets) {
      const availableGasTankAssets = res.data.gasTank.availableGasTankAssets

      pinnedGasTankTokens = availableGasTankAssets.reduce((acc: TokenResult[], token: any) => {
        const isGasTankToken = !!gasTankTokens.find(
          (gasTankToken: TokenResult) =>
            gasTankToken.symbol.toLowerCase() === token.symbol.toLowerCase()
        )
        const isAlreadyPinned = !!acc.find(
          (accToken) => accToken.symbol.toLowerCase() === token.symbol.toLowerCase()
        )

        if (isGasTankToken || isAlreadyPinned) return acc

        const correspondingPinnedToken = this.#pinned.find(
          (pinnedToken) =>
            (!('accountId' in pinnedToken) || pinnedToken.accountId === accountId) &&
            pinnedToken.address === token.address &&
            pinnedToken.networkId === token.network
        )

        if (correspondingPinnedToken && correspondingPinnedToken.onGasTank) {
          acc.push({
            address: token.address,
            symbol: token.symbol.toUpperCase(),
            amount: 0n,
            networkId: correspondingPinnedToken.networkId,
            decimals: token.decimals,
            priceIn: [
              {
                baseCurrency: 'USD',
                price: token.price
              }
            ],
            flags: {
              rewardsType: null,
              canTopUpGasTank: true,
              isFeeToken: true,
              onGasTank: true
            }
          })
        }
        return acc
      }, [])
    }

    accountState.gasTank = {
      isReady: true,
      isLoading: false,
      errors: [],
      result: {
        updateStarted: start,
        tokens: [...gasTankTokens, ...pinnedGasTankTokens],
        total: getTotal(gasTankTokens)
      }
    }

    this.emitUpdate()
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
      pinned?: PinnedTokens
    }
  ) {
    // set the additional pinned items if there are any
    if (opts?.pinned) {
      this.#pinned = [...this.#pinned, ...opts.pinned]
    }

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
      _accountState: AccountState,
      network: NetworkDescriptor,
      portfolioLib: Portfolio,
      portfolioProps: Partial<GetOptions>,
      forceUpdate: boolean
    ): Promise<boolean> => {
      if (!_accountState[network.id]) {
        _accountState[network.id] = { isReady: false, isLoading: false, errors: [] }
        this.emitUpdate()
      }

      const state = _accountState[network.id]!

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
        _accountState[network.id] = { isReady: true, isLoading: false, errors: [], result }
        this.emitUpdate()
        return true
      } catch (_e: any) {
        const e = _e instanceof Error ? _e : new Error(_e?.error || _e?.message || _e)

        this.emitError({
          level: 'silent',
          message: e.message,
          error: e
        })
        state.isLoading = false
        if (!state.isReady) state.criticalError = e
        else state.errors.push(e)
        this.emitUpdate()
        return false
      }
    }

    await Promise.all(
      networks.map(async (network) => {
        const key = `${network.id}:${accountId}`
        // Initialize a new Portfolio lib if:
        // 1. It does not exist in the portfolioLibs map
        // 2. The network RPC URL has changed
        if (
          !this.#portfolioLibs.has(key) ||
          this.#portfolioLibs.get(key)?.network?.rpcUrl !==
            // eslint-disable-next-line no-underscore-dangle
            this.#providers[network.id]?._getConnection().url
        ) {
          this.#portfolioLibs.set(key, new Portfolio(fetch, this.#providers[network.id], network))
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
          // eslint-disable-next-line prettier/prettier
          currentAccountOps && simulatedAccountOps
            ? !isAccountOpsIntentEqual(currentAccountOps, simulatedAccountOps)
            : currentAccountOps !== simulatedAccountOps

        const forceUpdate = opts?.forceUpdate || areAccountOpsChanged

        const [isSuccessfulLatestUpdate] = await Promise.all([
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
                  isEOA: !isSmartAccount(selectedAccount),
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
        // TODO: If we enable the below line, pending states stopped working in the application (extension).
        //  In the case we run this logic under a testing environment, then it works as expected.
        //  As it is not a deal-breaker (for now), we will comment it out and will fix it later this week.
        // if (isSuccessfulPendingUpdate && currentAccountOps) {
        //   pendingState[network.id]!.accountOps = currentAccountOps
        // }
      })
    )

    await this.#updateNetworksWithAssets(accounts, accountId, accountState)

    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      networksWithAssets: this.networksWithAssets
    }
  }
}
