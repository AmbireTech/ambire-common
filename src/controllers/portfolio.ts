import { Portfolio, GetOptions } from '../libs/portfolio/portfolio'
import { Hints, PortfolioGetResult } from '../libs/portfolio/interfaces'
import { Storage } from '../interfaces/storage'
import { NetworkDescriptor } from '../interfaces/networkDescriptor'
import { Account } from '../interfaces/account'
import { AccountOp } from '../libs/accountOp/accountOp'

import fetch from 'node-fetch'
import { JsonRpcProvider } from 'ethers'

type NetworkId = string
type AccountId = string
// @TODO fix the any
type PortfolioState = Map<AccountId, Map<NetworkId, any>>

export class PortfolioController {
  latest: PortfolioState
  pending: PortfolioState
  private portfolioLibs: Map<string, Portfolio>
  private storage: any
  private minUpdateInterval: number = 20000 // 20 seconds
  // @TODO - ts type
  private simulatedAccountOpsIds: Map<string, any>

  constructor(storage: Storage) {
    this.latest = new Map()
    this.pending = new Map()
    this.portfolioLibs = new Map()
    this.storage = storage
    this.simulatedAccountOpsIds = new Map()
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
    accountOps: AccountOp[] = [],
    opts?: {
      forceUpdate: boolean
    }
  ) {
    // Load storage cached hints
    const storagePreviousHints = await this.storage.get('previousHints', {})

    const selectedAccount = accounts.find((x) => x.addr === accountId)
    if (!selectedAccount) throw new Error('selected account does not exist')

    if (!this.latest.has(accountId)) this.latest.set(accountId, new Map())
    if (!this.pending.has(accountId)) this.pending.set(accountId, new Map())

    const accountState = this.latest.get(accountId)!
    for (const networkId of accountState.keys()) {
      if (!networks.find((x) => x.id === networkId)) accountState.delete(networkId)
    }

    const pendingState = this.pending.get(accountId)!
    for (const networkId of pendingState.keys()) {
      if (!networks.find((x) => x.id === networkId)) pendingState.delete(networkId)
    }

    const updatePortfolioState = async (
      accountState: Map<NetworkId, any>,
      network: NetworkDescriptor,
      portfolioLib: Portfolio,
      portfolioProps: Partial<GetOptions>,
      forceUpdate: boolean,
      onSuccess?: (results: PortfolioGetResult) => void
    ): Promise<void> => {
      if (!accountState.get(network.id))
        accountState.set(network.id, { isReady: false, isLoading: false })

      const state = accountState.get(network.id)!

      // When the portfolio was called lastly
      const lastUpdateStartedAt = state?.updateStarted
      if (
        lastUpdateStartedAt &&
        Date.now() - lastUpdateStartedAt <= this.minUpdateInterval &&
        !forceUpdate
      )
        return

      // Only one loading at a time, ensure there are no race conditions
      if (state.isLoading && !forceUpdate) return

      state.isLoading = true

      try {
        const results = await portfolioLib.get(accountId, {
          priceRecency: 60000,
          priceCache: state.priceCache,
          ...portfolioProps
        })

        if (!results.error && onSuccess) {
          onSuccess(results)
        }

        accountState.set(network.id, { isReady: true, isLoading: false, ...results })
      } catch (e) {
        state.isLoading = false
        if (!state.isReady) state.criticalError = e
        else state.errors = [e]
      }
    }

    await Promise.all(
      networks.map(async (network) => {
        const key = `${network.id}:${accountId}`
        if (!this.portfolioLibs.has(key)) {
          const provider = new JsonRpcProvider(network.rpcUrl)
          this.portfolioLibs.set(key, new Portfolio(fetch, provider, network))
        }
        const portfolioLib = this.portfolioLibs.get(key)!

        if (!this.simulatedAccountOpsIds.get(key)) {
          this.simulatedAccountOpsIds.set(key, [])
        }

        const networkAccountOps = accountOps?.filter(
          (accountOp) => accountOp.network.chainId === network.chainId
        )
        const networkAccountOpsIds = networkAccountOps.map((accountOp) => accountOp.id)
        const haveAccountOpsChanged = doArraysDiffer(
          networkAccountOpsIds,
          this.simulatedAccountOpsIds.get(key)
        )

        const forceUpdate = opts?.forceUpdate || haveAccountOpsChanged

        await Promise.all([
          // Latest state update
          (async () => {
            await updatePortfolioState(
              accountState,
              network,
              portfolioLib,
              {
                blockTag: 'latest',
                previousHints: storagePreviousHints[key]
              },
              forceUpdate,
              async (results) => {
                // Persist previousHints in the disk storage for further requests
                storagePreviousHints[key] = getHintsWithBalance(results)
                await this.storage.set('previousHints', storagePreviousHints)
              }
            )
          })(),
          // Pending state update
          (async () => {
            // We are updating the pending state, only if AccountOps are changed or the application logic requests a force update
            if (!forceUpdate) return

            await updatePortfolioState(
              pendingState,
              network,
              portfolioLib,
              {
                blockTag: 'pending',
                previousHints: storagePreviousHints[key],
                simulation: {
                  account: selectedAccount,
                  accountOps: networkAccountOps
                }
              },
              forceUpdate,
              async () => this.simulatedAccountOpsIds.set(key, networkAccountOpsIds)
            )
          })()
        ])
      })
    )

    // console.log({ latest: this.latest, pending: this.pending })
  }
}

// @TODO: move this into utils
// It checks for symmetric array difference
function doArraysDiffer(arr1: (string | number)[], arr2: (string | number)[]): boolean {
  return !!arr1.filter((x) => !arr2.includes(x)).concat(arr2.filter((x) => !arr1.includes(x)))
    .length
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

// @TODO: move this into utils
export function produceMemoryStore(): Storage {
  const storage = new Map()
  return {
    get: (key, defaultValue): any => {
      const serialized = storage.get(key)
      return Promise.resolve(serialized ? JSON.parse(serialized) : defaultValue)
    },
    set: (key, value) => {
      storage.set(key, JSON.stringify(value))
      return Promise.resolve(null)
    }
  }
}
