import { ZeroAddress } from 'ethers'
import { getAddress, isHex } from 'viem'

import { AccountId } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider, RPCProviders } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import { getAssetValue, getProviderId } from '../../libs/defiPositions/helpers'
import {
  getAAVEPositions,
  getDebankEnhancedUniV3Positions,
  getStakedWalletPositions
} from '../../libs/defiPositions/providers'
import getAccountNetworksWithPositions from '../../libs/defiPositions/providers/helpers/networksWithPositions'
import {
  AssetType,
  DeFiPositionsError,
  NetworksWithPositions,
  NetworksWithPositionsByAccounts,
  PositionsByProvider,
  ProviderError
} from '../../libs/defiPositions/types'
import { TokenResult } from '../../libs/portfolio'
import { AccountState, PortfolioNetworkResult } from '../../libs/portfolio/interfaces'
import { fetchWithTimeout } from '../../utils/fetch'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'
/* eslint-disable no-restricted-syntax */
import shortenAddress from '../../utils/shortenAddress'
import EventEmitter from '../eventEmitter/eventEmitter'

const isTokenPriceWithinHalfPercent = (price1: number, price2: number): boolean => {
  const diff = Math.abs(price1 - price2)
  const threshold = 0.005 * Math.max(Math.abs(price1), Math.abs(price2))
  return diff <= threshold
}

export class DefiPositionsController extends EventEmitter {
  #networksWithPositionsByAccounts: NetworksWithPositionsByAccounts = {}

  sessionIds: string[] = []

  #fetch: any

  #storage: IStorageController

  initialLoadPromise?: Promise<void>

  constructor(fetch: any, storage: IStorageController) {
    super()
    this.#fetch = fetch
    this.#storage = storage
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    try {
      this.#networksWithPositionsByAccounts = await this.#storage.get(
        'networksWithPositionsByAccounts',
        {}
      )
    } catch (e: any) {
      this.emitError({
        message: 'Failed to load DeFi positions data from storage.',
        error: e,
        level: 'silent'
      })
    }
  }

  async updateNetworksWithPositions(
    accountId: AccountId,
    accountState: AccountState,
    providers: RPCProviders
  ) {
    this.#networksWithPositionsByAccounts[accountId] = getAccountNetworksWithPositions(
      accountId,
      accountState,
      this.#networksWithPositionsByAccounts,
      providers
    )

    await this.#storage.set(
      'networksWithPositionsByAccounts',
      this.#networksWithPositionsByAccounts
    )
  }

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
    customPositions: PositionsByProvider[],
    stkWalletPosition: PositionsByProvider | null
  ): PositionsByProvider[] {
    const debankPositionMap = new Map(
      debankNetworkPositionsByProvider.map((p) => [getProviderId(p.providerName), p])
    )

    customPositions.forEach((custom) => {
      const key = getProviderId(custom.providerName)

      debankPositionMap.set(key, custom)
    })

    if (stkWalletPosition) {
      const key = getProviderId(stkWalletPosition.providerName)
      debankPositionMap.set(key, stkWalletPosition)
    }

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

  static getAllAssetsAsHints(portfolioState: PortfolioNetworkResult['defiPositions'] | undefined) {
    if (!portfolioState) return []
    const hints: string[] = []

    portfolioState.positionsByProvider.forEach((providerPositions) => {
      providerPositions.positions.forEach((position) => {
        position.assets.forEach((asset) => {
          hints.push(asset.address.toLowerCase())

          if (asset.protocolAsset) {
            hints.push(asset.protocolAsset.address)
          }
        })
      })
    })

    return hints
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

    const stkWalletPosition = getStakedWalletPositions(stkWalletToken)

    const uniqueAndMerged = DefiPositionsController.getUniqueMergedPositions(
      isDebankCallSuccessful
        ? debankPositionsByProvider
        : previousPositionsByProvider.filter((p) => p.source === 'debank'),
      customPositionsByProvider,
      // Ethereum-specific. Add the Staked Wallet token as a defi position
      stkWalletPosition
    )

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
              address: isHex(asset.address) ? getAddress(asset.address) : ZeroAddress,
              amount: BigInt(asset.amount),
              protocolAsset: asset.protocolAsset
                ? {
                    ...asset.protocolAsset,
                    address: isHex(asset.protocolAsset.address)
                      ? getAddress(asset.protocolAsset.address)
                      : ZeroAddress
                  }
                : undefined
            }))
          }
        } catch (error) {
          console.error('DeFi error: ', error)
          return pos
        }
      })
    }))
  }

  enhancePortfolioTokensWithDefiPositions(
    portfolioTokens: TokenResult[],
    defiPositionsState: PortfolioNetworkResult['defiPositions'] | undefined
  ): TokenResult[] {
    if (!defiPositionsState) return portfolioTokens

    try {
      const defiAssetsMap = new Map<
        string,
        {
          assetType?: AssetType
          priceIn?: TokenResult['priceIn']
          positionId: string
        }
      >()
      const notYetHandledTokensToAdd: TokenResult[] = []

      defiPositionsState.positionsByProvider.forEach((posByProvider) => {
        posByProvider.positions.forEach((pos) => {
          try {
            const controllerAddress = pos.additionalData?.pool?.controller as string | undefined

            if (controllerAddress) {
              defiAssetsMap.set(controllerAddress.toLowerCase(), {
                positionId: pos.id,
                priceIn: []
              })
            }

            pos.assets.forEach((asset) => {
              const protocolAsset = asset.protocolAsset || null

              if (!protocolAsset) return

              const tokenCorrespondingToProtocolAsset = portfolioTokens.find((t) => {
                const isSameAddress = t.address === protocolAsset.address

                if (isSameAddress) return true

                const priceUSD = t.priceIn.find(
                  ({ baseCurrency }: { baseCurrency: string }) =>
                    baseCurrency.toLowerCase() === 'usd'
                )?.price

                const tokenBalanceUSD = priceUSD
                  ? Number(
                      safeTokenAmountAndNumberMultiplication(
                        BigInt(t.amountPostSimulation || t.amount),
                        t.decimals,
                        priceUSD
                      )
                    )
                  : undefined

                if (protocolAsset.symbol && protocolAsset.address) {
                  return (
                    !t.flags.rewardsType &&
                    !t.flags.onGasTank &&
                    t.address.toLowerCase() === protocolAsset.address.toLowerCase()
                  )
                }

                // If the token or asset don't have a value we MUST! not compare them
                // by value as that would lead to false positives
                if (!tokenBalanceUSD || !asset.value) return false

                // If there is no protocol asset we have to fallback to finding the token
                // by symbol and chainId. In that case we must ensure that the value of the two
                // assets is similar
                return (
                  !t.flags.rewardsType &&
                  !t.flags.onGasTank &&
                  // the portfolio token should contain the original asset symbol
                  t.symbol.toLowerCase().includes(asset.symbol.toLowerCase()) &&
                  // but should be a different token symbol
                  t.symbol.toLowerCase() !== asset.symbol.toLowerCase() &&
                  // and prices should have no more than 0.5% diff
                  isTokenPriceWithinHalfPercent(tokenBalanceUSD || 0, asset.value || 0)
                )
              })

              if (tokenCorrespondingToProtocolAsset) {
                defiAssetsMap.set(tokenCorrespondingToProtocolAsset.address.toLowerCase(), {
                  assetType: asset.type,
                  positionId: pos.id,
                  priceIn: asset.priceIn ? [asset.priceIn] : []
                })
              } else {
                notYetHandledTokensToAdd.push({
                  amount: asset.amount,
                  latestAmount: asset.amount,
                  // Only list the borrowed asset with no price
                  priceIn:
                    asset.type === AssetType.Collateral && asset.priceIn ? [asset.priceIn] : [],
                  decimals: Number(protocolAsset.decimals),
                  address: protocolAsset.address,
                  symbol: protocolAsset.symbol,
                  name: protocolAsset.name,
                  chainId: BigInt(posByProvider.chainId),
                  flags: {
                    canTopUpGasTank: false,
                    isFeeToken: false,
                    onGasTank: false,
                    rewardsType: null,
                    defiTokenType: asset.type,
                    defiPositionId: pos.id
                  }
                })
              }
            })
          } catch (e: any) {
            this.emitError({
              message: 'Failed to enhance a portfolio token with DeFi position data.',
              error: e,
              level: 'silent'
            })
          }
        })
      })

      const enhancedTokenList = portfolioTokens.map((token) => {
        const defiAssetData = defiAssetsMap.get(token.address.toLowerCase())

        if (!defiAssetData) return token

        let priceIn = token.priceIn

        if (defiAssetData?.assetType === AssetType.Borrow) {
          priceIn = []
        } else if (
          defiAssetData.priceIn &&
          (!token.priceIn.length || token.priceIn[0]!.price <= 0)
        ) {
          priceIn = defiAssetData.priceIn
        }

        const newToken = {
          ...token,
          priceIn,
          flags: {
            ...token.flags,
            defiPositionId: defiAssetData?.positionId,
            defiTokenType: defiAssetData?.assetType
          }
        }

        defiAssetsMap.delete(token.address)

        return newToken
      })

      return [...enhancedTokenList, ...notYetHandledTokensToAdd]
    } catch (e: any) {
      this.emitError({
        message: 'Failed to enhance portfolio tokens with DeFi positions.',
        error: e,
        level: 'silent'
      })

      return portfolioTokens
    }
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

  /**
   * Whether the portfolio defi positions data should be cached server-side
   * or the latest should be retrieved.
   */
  getCanSkipUpdate(
    previousState: PortfolioNetworkResult['defiPositions'] | undefined,
    nonceId: string | undefined,
    hasKeys: boolean,
    opts?: {
      maxDataAgeMs?: number
      isManualUpdate?: boolean
    }
  ) {
    if (!previousState || !previousState.updatedAt) return false

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { maxDataAgeMs: _maxDataAgeMs = 60000, isManualUpdate = false } = opts || {}
    let maxDataAgeMs = _maxDataAgeMs

    // force update the positions if forceUpdate is passed,
    // the account has keys and a session with the DeFi tab is opened
    const shouldForceUpdatePositions = isManualUpdate && this.sessionIds.length && hasKeys

    if (shouldForceUpdatePositions) maxDataAgeMs = 30000 // half a min

    const isWithinMinUpdateInterval = Date.now() - previousState.updatedAt < maxDataAgeMs

    const canSkip = isWithinMinUpdateInterval || previousState.isLoading

    if (canSkip) return true

    // Don't skip if the account has any DeFi positions or the account has never been updated
    if (
      Object.values(previousState).some(
        (network) => network.positionsByProvider.length || !network.updatedAt
      )
    )
      return false

    if (!nonceId) return false

    return nonceId !== previousState.nonceId
  }

  getNetworksWithPositions(accountAddr: string): NetworksWithPositions {
    return this.#networksWithPositionsByAccounts[accountAddr] || {}
  }

  addSession(sessionId: string) {
    this.sessionIds = [...new Set([...this.sessionIds, sessionId])]
  }

  removeSession(sessionId: string) {
    this.sessionIds = this.sessionIds.filter((id) => id !== sessionId)
  }
}
