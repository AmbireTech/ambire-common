import { Portfolio } from '../libs/portfolio/portfolio'
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

  constructor(storage: Storage) {
    this.latest = new Map()
    this.pending = new Map()
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
    accountOps: AccountOp[]
  ) {
    // Load storage cached hints
    const storagePreviousHints = await this.storage.get('previousHints', {})

    const selectedAccount = accounts.find((x) => x.addr === accountId)
    if (!selectedAccount) throw new Error('selected account does not exist')
    // @TODO update pending AND latest state together in case we have accountOps
    if (!this.latest.has(accountId)) this.latest.set(accountId, new Map())
    const accountState = this.latest.get(accountId)!
    for (const networkId of accountState.keys()) {
      if (!networks.find((x) => x.id === networkId)) accountState.delete(networkId)
    }
    await Promise.all(
      networks.map(async (network) => {
        const key = `${network.id}:${accountId}`
        if (!this.portfolioLibs.has(key)) {
          const provider = new JsonRpcProvider(network.rpcUrl)
          this.portfolioLibs.set(key, new Portfolio(fetch, provider, network))
        }
        const portfolioLib = this.portfolioLibs.get(key)!
        // @TODO full state handling
        // @TODO discoveredTokens fallback
        if (!accountState.get(network.id))
          accountState.set(network.id, { isReady: false, isLoading: false })
        const state = accountState.get(network.id)!
        // Only one loading at a time, ensure there are no race conditions
        if (state.isLoading) return
        state.isLoading = true
        try {
          const results = await portfolioLib.get(accountId, {
            priceRecency: 60000,
            priceCache: state.priceCache,
            previousHints: storagePreviousHints[key]
          })
          // Don't update previous hints (cache), if the hints request fails
          if (!results.error) {
            // Persist previousHints in the disk storage for further requests
            storagePreviousHints[key] = getHintsWithBalance(results)
            await this.storage.set('previousHints', storagePreviousHints)
          }
          accountState.set(network.id, { isReady: true, isLoading: false, ...results })
        } catch (e) {
          state.isLoading = false
          if (!state.isReady) state.criticalError = e
          else state.errors = [e]
        }
      })
    )
    // console.log(this.latest)
    // console.log(accounts, networks, accountOps)
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
