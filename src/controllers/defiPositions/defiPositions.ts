import { TokenResult } from 'libs/portfolio'

import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { getAssetValue, getProviderId } from '../../libs/defiPositions/helpers'
import {
  getAAVEPositions,
  getDebankEnhancedUniV3Positions,
  getStakedWalletPositions
} from '../../libs/defiPositions/providers'
import {
  DeFiPositionsError,
  NetworksWithPositionsByAccounts,
  PositionsByProvider,
  ProviderError
} from '../../libs/defiPositions/types'
import { fetchWithTimeout } from '../../utils/fetch'
/* eslint-disable no-restricted-syntax */
import shortenAddress from '../../utils/shortenAddress'

export class DefiPositionsController {
  // #state: DeFiPositionsState = {}

  #networksWithPositionsByAccounts: NetworksWithPositionsByAccounts = {}

  // sessionIds: string[] = []

  #fetch: any

  // #positionsContinuousUpdateInterval: IRecurringTimeout

  #updatePositionsPromise: Promise<void> | undefined

  // get positionsContinuousUpdateInterval() {
  //   return this.#positionsContinuousUpdateInterval
  // }

  constructor(fetch: any) {
    this.#fetch = fetch
    // this.#positionsContinuousUpdateInterval = new RecurringTimeout(
    //   async () => this.positionsContinuousUpdate(),
    //   ACTIVE_EXTENSION_DEFI_POSITIONS_UPDATE_INTERVAL,
    //   this.emitError.bind(this)
    // )

    // this.#ui.uiEvent.on('addView', () => {
    //   this.#positionsContinuousUpdateInterval.start()
    // })

    // this.#ui.uiEvent.on('removeView', () => {
    //   if (!this.#ui.views.length) this.#positionsContinuousUpdateInterval.stop()
    // })
  }

  // async #load() {
  //   try {
  //     this.#networksWithPositionsByAccounts = await this.#storage.get(
  //       'networksWithPositionsByAccounts',
  //       {}
  //     )

  //     this.emitUpdate()
  //   } catch (e: any) {
  //     this.emitError({
  //       message: 'Failed to load DeFi positions data from storage.',
  //       error: e,
  //       level: 'silent'
  //     })
  //   }
  // }

  // #getShouldSkipUpdate(
  //   accountAddr: string,
  //   _maxDataAgeMs = ONE_MINUTE,
  //   forceUpdate: boolean = false
  // ) {
  //   const hasKeys = this.#keystore.keys.some(({ addr }) =>
  //     this.#selectedAccount.account!.associatedKeys.includes(addr)
  //   )
  //   let maxDataAgeMs = _maxDataAgeMs

  //   // force update the positions if forceUpdate is passed,
  //   // the account has keys and a session with the DeFi tab is opened
  //   const shouldForceUpdatePositions = forceUpdate && this.sessionIds.length && hasKeys
  //   if (shouldForceUpdatePositions) maxDataAgeMs = 30000 // half a min

  //   let latestUpdatedAt: number | undefined

  //   const accountState = Object.values(this.#state[accountAddr])
  //   // eslint-disable-next-line no-restricted-syntax
  //   for (const network of accountState) {
  //     if (typeof network.updatedAt === 'number') {
  //       if (latestUpdatedAt === undefined || network.updatedAt > latestUpdatedAt) {
  //         latestUpdatedAt = network.updatedAt
  //       }
  //     }
  //   }

  //   if (!latestUpdatedAt) return false

  //   if (!forceUpdate && accountState.some((n) => n.providerErrors?.length || n.error)) {
  //     maxDataAgeMs = ONE_MINUTE
  //   }

  //   const isWithinMinUpdateInterval = Date.now() - latestUpdatedAt < maxDataAgeMs

  //   return isWithinMinUpdateInterval || accountState.some((n) => n.isLoading)
  // }

  // @TODO: Reimplement
  // async #updateNetworksWithPositions(accountId: AccountId, accountState: AccountState) {
  //   this.#networksWithPositionsByAccounts[accountId] = getAccountNetworksWithPositions(
  //     accountId,
  //     accountState,
  //     this.#networksWithPositionsByAccounts,
  //     this.#providers.providers
  //   )

  //   await this.#storage.set(
  //     'networksWithPositionsByAccounts',
  //     this.#networksWithPositionsByAccounts
  //   )
  // }

  /**
   * Fetches the defi positions of certain protocols using RPC calls and custom logic.
   * Cena is used for most of the positions, but some protocols require additional data
   * that is not available in Cena. This function fetches those positions on ENABLED
   * networks only.
   *
   * Returns the old positions if the call fails. Some positions, like that of Uniswap V3,
   * are merged with the data from Cena/Debank.
   */
  async getCustomProviderPositions(
    addr: string,
    provider: RPCProvider,
    network: Network,
    previousPositions: PositionsByProvider[],
    debankNetworkPositionsByProvider: PositionsByProvider[],
    isDebankCallSuccessful: boolean
  ): Promise<{
    positionsByProvider: PositionsByProvider[]
    providerErrors: ProviderError[]
    error?: DeFiPositionsError | null
  }> {
    if (network.disabled)
      return {
        positionsByProvider: [],
        providerErrors: []
      }

    try {
      const providerErrors: ProviderError[] = []
      let error: any

      let newPositions = (
        await Promise.all([
          getAAVEPositions(addr, provider, network).catch((e: any) => {
            providerErrors.push({
              providerName: 'AAVE v3',
              error: e?.message || 'Unknown error'
            })

            return null
          }),
          // Uniswap is a bit of an odd case. We return the positions merged with Debank data
          getDebankEnhancedUniV3Positions(
            addr,
            provider,
            network,
            previousPositions,
            debankNetworkPositionsByProvider,
            isDebankCallSuccessful
          ).catch((e: any) => {
            providerErrors.push({
              providerName: 'Uniswap V3',
              error: e?.message || 'Unknown error'
            })

            return null
          })
        ])
      ).filter(Boolean) as PositionsByProvider[]

      if (newPositions.length) {
        try {
          newPositions =
            (await this.updatePositionsByProviderAssetPrices(newPositions, network.platformId)) ||
            newPositions
        } catch (e) {
          console.error(`#setAssetPrices error for ${addr} on ${network.name}:`, e)
          error = DeFiPositionsError.AssetPriceError
        }
      }

      // Get the previous custom positions that were not updated in this call
      // This is done so the user doesn't lose their custom positions when the
      // new update fails
      const filteredPrevious = previousPositions.filter(
        (prev) =>
          prev.source === 'custom' &&
          !newPositions.some(
            (n) => getProviderId(n.providerName) === getProviderId(prev.providerName)
          )
      )

      return {
        positionsByProvider: [...filteredPrevious, ...newPositions],
        providerErrors,
        error
      }
    } catch (e: any) {
      return {
        positionsByProvider: previousPositions.filter((p) => p.source === 'custom'),
        providerErrors: [],
        error: DeFiPositionsError.CriticalError
      }
    }
  }

  /**
   * Merges Debank positions with custom fetched positions, ensuring uniqueness by provider.
   */
  static getUniqueMergedPositions(
    debankNetworkPositionsByProvider: PositionsByProvider[],
    customPositions: PositionsByProvider[]
  ): PositionsByProvider[] {
    const debankPositionMap = new Map(
      debankNetworkPositionsByProvider.map((p) => [getProviderId(p.providerName), p])
    )

    customPositions.forEach((custom) => {
      const key = getProviderId(custom.providerName)

      debankPositionMap.set(key, custom)
    })

    let positionsArray = Array.from(debankPositionMap.values())

    // Sort the assets, positions by provider and provider positions by their value in USD descending
    positionsArray = positionsArray.map((providerPositions) => ({
      ...providerPositions,
      positions: providerPositions.positions
        .map((position) => ({
          ...position,
          assets: position.assets.sort((a, b) => (b.value || 0) - (a.value || 0))
        }))
        .sort(
          (a, b) => (b.additionalData.positionInUSD || 0) - (a.additionalData.positionInUSD || 0)
        )
    }))

    positionsArray = positionsArray.sort((a, b) => (b.positionInUSD || 0) - (a.positionInUSD || 0))

    return positionsArray
  }

  /**
   * Updates an account's positions for a single network.
   */
  static getNewDefiState(
    debankPositionsByProvider: PositionsByProvider[] | undefined,
    previousPositionsByProvider: PositionsByProvider[],
    customPositionsByProvider: PositionsByProvider[],
    customPositionsError: DeFiPositionsError | null,
    customProvidersErrors: ProviderError[],
    stkWalletToken: TokenResult | null,
    nonceId: string | undefined
  ) {
    const isDebankCallSuccessful = !!debankPositionsByProvider

    const uniqueAndMerged = DefiPositionsController.getUniqueMergedPositions(
      isDebankCallSuccessful
        ? debankPositionsByProvider
        : previousPositionsByProvider.filter((p) => p.source === 'debank'),
      customPositionsByProvider
    )
    // Ethereum-specific. Add the Staked Wallet token as a defi position
    const stkWalletPosition = getStakedWalletPositions(stkWalletToken)

    if (stkWalletPosition) {
      uniqueAndMerged.unshift(stkWalletPosition)
    }

    return {
      nonceId,
      isLoading: false,
      error: !isDebankCallSuccessful ? DeFiPositionsError.CriticalError : customPositionsError,
      updatedAt: isDebankCallSuccessful && !customPositionsError ? Date.now() : undefined,
      providerErrors: customProvidersErrors,
      positionsByProvider: uniqueAndMerged || previousPositionsByProvider
    }
  }

  static getFormattedApiPositions(result: Omit<PositionsByProvider, 'source'>[]) {
    return result.map((p) => ({
      ...p,
      source: 'debank' as const,
      chainId: BigInt(p.chainId),
      positions: p.positions.map((pos) => {
        try {
          if (pos.additionalData.name === 'Deposit') {
            // eslint-disable-next-line no-param-reassign
            pos.additionalData.name = 'Deposit pool'
            // eslint-disable-next-line no-param-reassign
            pos.additionalData.positionIndex = shortenAddress(pos.additionalData.pool.id, 11)
          }

          return {
            ...pos,
            assets: pos.assets.map((asset) => ({
              ...asset,
              amount: BigInt(asset.amount)
            }))
          }
        } catch (error) {
          console.error('DeFi error: ', error)
          return pos
        }
      })
    }))
  }

  /**
   * Fetches the USD prices for the assets in the provided positions
   * using cena and updates the positions with the fetched prices and values.
   *
   * Note: It's private so we can mock it in tests.
   */
  private async updatePositionsByProviderAssetPrices(
    positionsByProvider: PositionsByProvider[],
    platformId: string | null = null
  ) {
    // If we can't determine the Gecko platform ID, we shouldn't make a request to price (cena.ambire.com)
    // since it would return nothing.
    // This can happen when adding a custom network that doesn't have a CoinGecko platform ID.
    if (!platformId) return null

    const dedup = (x: any[]) => x.filter((y, i) => x.indexOf(y) === i)

    const addresses: string[] = []

    positionsByProvider.forEach((providerPos) => {
      providerPos.positions.forEach((p) => {
        p.assets.forEach((a) => {
          addresses.push(a.address)
        })
      })
    })

    const cenaUrl = `https://cena.ambire.com/api/v3/simple/token_price/${platformId}?contract_addresses=${dedup(
      addresses
    ).join('%2C')}&vs_currencies=usd`

    const resp = await fetchWithTimeout(this.#fetch, cenaUrl, {}, 3000)
    const body = await resp.json()
    if (resp.status !== 200) throw body
    // eslint-disable-next-line no-prototype-builtins
    if (body.hasOwnProperty('message')) throw body
    // eslint-disable-next-line no-prototype-builtins
    if (body.hasOwnProperty('error')) throw body

    const positionsByProviderWithPrices = positionsByProvider.map((posByProvider) => {
      if (getProviderId(posByProvider.providerName).includes('aave')) return posByProvider

      const updatedPositions = posByProvider.positions.map((position) => {
        let positionInUSD = position.additionalData.positionInUSD || 0

        const updatedAssets = position.assets.map((asset) => {
          const priceData = body[asset.address.toLowerCase()]
          if (!priceData) return asset

          const priceIn = Object.entries(priceData).map(([currency, price]) => ({
            baseCurrency: currency,
            price: price as number
          }))

          const value = getAssetValue(asset.amount, asset.decimals, priceIn) || 0

          if (!position.additionalData.positionInUSD) {
            positionInUSD += value
          }

          return { ...asset, value, priceIn: priceIn[0]! }
        })

        return {
          ...position,
          assets: updatedAssets,
          additionalData: { ...position.additionalData, positionInUSD }
        }
      })

      let positionInUSD = posByProvider.positionInUSD

      // Already set in the corresponding lib
      if (!positionInUSD) {
        positionInUSD = updatedPositions.reduce((prevPositionValue, position) => {
          return prevPositionValue + (position.additionalData.positionInUSD || 0)
        }, 0)
      }

      return { ...posByProvider, positions: updatedPositions, positionInUSD }
    })

    return positionsByProviderWithPrices
  }

  // #getShouldSkipUpdateOnAccountWithNoDefiPositions(acc: Account, forceUpdate?: boolean) {
  //   if (forceUpdate) return false
  //   if (!this.#accounts.accountStates[acc.addr]) return false
  //   if (!this.#state[acc.addr]) return false
  //   // Don't skip if the account has any DeFi positions or the account has never been updated
  //   if (
  //     Object.values(this.#state[acc.addr]).some(
  //       (network) => network.positionsByProvider.length || !network.updatedAt
  //     )
  //   )
  //     return false
  //   const someNonceIdChanged = Object.keys(this.#accounts.accountStates[acc.addr]).some(
  //     (chainId: string) => {
  //       const posNonceId = this.#state[acc.addr][chainId]?.nonceId
  //       const nonceId = this.#getNonceId(acc, chainId)

  //       if (!nonceId || !posNonceId) return false

  //       return nonceId !== posNonceId
  //     }
  //   )

  //   // Return false (don’t skip) if any nonceId has changed
  //   return !someNonceIdChanged
  // }

  // removeNetworkData(chainId: bigint) {
  //   Object.keys(this.#state).forEach((accountId) => {
  //     delete this.#state[accountId][chainId.toString()]
  //   })
  //   this.emitUpdate()
  // }

  // getDefiPositionsStateForAllNetworks(accountAddr: string) {
  //   // return defi positions for enabled and disabled networks
  //   return this.#state[accountAddr] || {}
  // }

  // getDefiPositionsState(accountAddr: string) {
  //   // return defi positions only for enabled networks
  //   return Object.entries(this.#state[accountAddr] || {}).reduce((acc, [chainId, networkState]) => {
  //     if (this.#networks.networks.find((n) => n.chainId.toString() === chainId)) {
  //       acc[chainId] = networkState
  //     }
  //     return acc
  //   }, {} as AccountState)
  // }

  // getNetworksWithPositions(accountAddr: string) {
  //   return this.#networksWithPositionsByAccounts[accountAddr] || []
  // }

  // removeAccountData(accountAddr: string) {
  //   delete this.#state[accountAddr]
  //   delete this.#networksWithPositionsByAccounts[accountAddr]
  //   this.#storage.set('networksWithPositionsByAccounts', this.#networksWithPositionsByAccounts)

  //   this.emitUpdate()
  // }

  // addSession(sessionId: string) {
  //   this.sessionIds = [...new Set([...this.sessionIds, sessionId])]
  //   this.emitUpdate()
  // }

  // removeSession(sessionId: string) {
  //   this.sessionIds = this.sessionIds.filter((id) => id !== sessionId)
  //   this.emitUpdate()
  // }

  // async positionsContinuousUpdate() {
  //   if (!this.#ui.views.length) {
  //     this.#positionsContinuousUpdateInterval.stop()
  //     return
  //   }

  //   const FIVE_MINUTES = 1000 * 60 * 5
  //   await this.updatePositions({ maxDataAgeMs: FIVE_MINUTES })
  // }

  // toJSON() {
  //   return {
  //     ...this,
  //     ...super.toJSON()
  //   }
  // }
}
