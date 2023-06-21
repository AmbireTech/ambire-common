import { Portfolio, GetOptions } from '../libs/portfolio/portfolio'
import { Hints, PortfolioGetResult } from '../libs/portfolio/interfaces'
import { Storage } from '../interfaces/storage'
import { NetworkDescriptor } from '../interfaces/networkDescriptor'
import { Account, AccountId } from '../interfaces/account'
import { AccountOp } from '../libs/accountOp/accountOp'

import fetch from 'node-fetch'
import { JsonRpcProvider } from 'ethers'

type AccountState = {
  // network id
  [key: string]:
    | {
        isReady: boolean
        isLoading: boolean
        criticalError?: Error
        errors?: Error[]
        result?: PortfolioGetResult
        // already simulated AccountOp
        accountOps?: AccountOp[]
      }
    | undefined
}
// account => network => PortfolioGetResult, extra fields
type PortfolioControllerState = {
  // account id
  [key: string]: AccountState
}

export class PortfolioController {
  latest: PortfolioControllerState
  pending: PortfolioControllerState
  private portfolioLibs: Map<string, Portfolio>
  private storage: any
  private minUpdateInterval: number = 20000 // 20 seconds

  constructor(storage: Storage) {
    this.latest = {}
    this.pending = {}
    this.portfolioLibs = new Map()
    this.storage = storage
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
    // account => network => AccountOp[]
    accountOps?: { [key: string]: { [key: string]: AccountOp[] } },
    opts?: {
      forceUpdate: boolean
    }
  ) {
    // Load storage cached hints
    const storagePreviousHints = await this.storage.get('previousHints', {})

    const selectedAccount = accounts.find((x) => x.addr === accountId)
    if (!selectedAccount) throw new Error('selected account does not exist')

    if (!this.latest[accountId]) this.latest[accountId] = {}
    if (!this.pending[accountId]) this.pending[accountId] = {}

    const accountState = this.latest[accountId]
    for (const networkId of Object.keys(accountState)) {
      if (!networks.find((x) => x.id === networkId)) delete accountState[networkId]
    }

    const pendingState = this.pending[accountId]
    for (const networkId of Object.keys(pendingState)) {
      if (!networks.find((x) => x.id === networkId)) delete pendingState[networkId]
    }

    const updatePortfolioState = async (
      accountState: AccountState,
      network: NetworkDescriptor,
      portfolioLib: Portfolio,
      portfolioProps: Partial<GetOptions>,
      forceUpdate: boolean,
      onSuccess?: (results: PortfolioGetResult) => void
    ): Promise<void> => {
      if (!accountState[network.id]) accountState[network.id] = { isReady: false, isLoading: false }

      const state = accountState[network.id]!

      // When the portfolio was called lastly
      const lastUpdateStartedAt = state.result?.updateStarted
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
        const result = await portfolioLib.get(accountId, {
          priceRecency: 60000,
          priceCache: state.result?.priceCache,
          ...portfolioProps
        })

        accountState[network.id] = { isReady: true, isLoading: false, result }

        if (!result.error && onSuccess) {
          onSuccess(result)
        }
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

        const currentAccountOps = accountOps?.[accountId]?.[network.id]
        const simulatedAccountOps = pendingState[network.id]?.accountOps

        const forceUpdate =
          opts?.forceUpdate ||
          stringifyWithBigInt(currentAccountOps) !== stringifyWithBigInt(simulatedAccountOps)

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
                ...(currentAccountOps && {
                  simulation: {
                    account: selectedAccount,
                    accountOps: currentAccountOps
                  }
                })
              },
              forceUpdate,
              async () => {
                pendingState[network.id]!.accountOps = currentAccountOps
              }
            )
          })()
        ])
      })
    )

    // console.log({ latest: this.latest, pending: this.pending })
  }
}

// By default, JSON.stringify doesn't stringifies BigInt.
// Because of this, we are adding support for BigInt values with this utility function.
// @TODO: move this into utils
function stringifyWithBigInt(value: any): string {
  return JSON.stringify(value, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  )
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
