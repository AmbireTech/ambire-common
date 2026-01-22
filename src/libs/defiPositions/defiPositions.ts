import { getAddress, ZeroAddress } from 'ethers'
import { isHex } from 'viem'

import { AccountId } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider, RPCProviders } from '../../interfaces/provider'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'
import shortenAddress from '../../utils/shortenAddress'
import { TokenResult } from '../portfolio'
import {
  AccountState,
  FormattedPortfolioDiscoveryResponse,
  PortfolioNetworkResult
} from '../portfolio/interfaces'
import { updatePositionsByProviderAssetPrices } from './defiPrices'
import { getAssetValue, getProviderId, isTokenPriceWithinHalfPercent } from './helpers'
import {
  getAAVEPositions,
  getDebankEnhancedUniV3Positions,
  getStakedWalletPositions
} from './providers'
import {
  AssetType,
  DeFiPositionsError,
  NetworkState,
  NetworksWithPositions,
  NetworksWithPositionsByAccounts,
  Position,
  PositionsByProvider,
  ProviderError
} from './types'

export const getIsExternalApiDefiPositionsCallSuccessful = (
  discoveryResponse: FormattedPortfolioDiscoveryResponse | null
): boolean => {
  // If the request was skipped (no data, no errors) consider it successful
  if (!discoveryResponse) return true

  return !!discoveryResponse.data?.defi
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
const getCustomProviderPositions = async (
  addr: string,
  provider: RPCProvider,
  network: Network,
  fetch: Function,
  previousPositions: PositionsByProvider[],
  debankNetworkPositionsByProvider: PositionsByProvider[] | undefined,
  isDebankCallSuccessful: boolean
): Promise<{
  positionsByProvider: PositionsByProvider[]
  providerErrors: ProviderError[]
  error?: DeFiPositionsError | null
}> => {
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
          debankNetworkPositionsByProvider ||
            previousPositions.filter((p) => p.source !== 'custom'),
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
          (await updatePositionsByProviderAssetPrices(fetch, newPositions, network.platformId)) ||
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
    console.error('Critical error fetching custom defi positions:', e)
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
const getUniqueMergedPositions = (
  debankNetworkPositionsByProvider: PositionsByProvider[],
  customPositions: PositionsByProvider[],
  stkWalletPosition: PositionsByProvider | null
): PositionsByProvider[] => {
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
      .sort((a, b) => (b.additionalData.positionInUSD || 0) - (a.additionalData.positionInUSD || 0))
  }))

  positionsArray = positionsArray.sort((a, b) => (b.positionInUSD || 0) - (a.positionInUSD || 0))

  return positionsArray
}

/**
 * Returns the addresses of all assets and their protocolAssets (if applicable) as an
 * array of addresses. These addresses can be used as hints by the portfolio controller.
 */
const getAllAssetsAsHints = (
  portfolioState: PortfolioNetworkResult['defiPositions'] | undefined
) => {
  if (!portfolioState) return []
  const hints: string[] = []

  portfolioState.positionsByProvider.forEach((providerPositions) => {
    providerPositions.positions.forEach((position) => {
      position.assets.forEach((asset) => {
        if (!isHex(asset.address)) return
        hints.push(asset.address.toLowerCase())

        if (asset.protocolAsset) {
          if (!isHex(asset.protocolAsset.address)) return
          hints.push(asset.protocolAsset.address.toLowerCase())
        }
      })
    })
  })

  return hints
}

/**
 * Calculates the new DeFi positions state based on the latest fetched data
 * from Debank and custom providers and the previous state.
 * It ensures that positions are unique, merged correctly and that if the
 * latest Debank call failed, the previous positions are retained.
 */
const getNewDefiState = (
  pastPortfolioState: PortfolioNetworkResult | undefined,
  discoveryResponse: FormattedPortfolioDiscoveryResponse | null,
  customPositionsByProvider: PositionsByProvider[],
  customPositionsError: DeFiPositionsError | null,
  customProvidersErrors: ProviderError[],
  stkWalletToken: TokenResult | null,
  nonceId: string | undefined
): NetworkState => {
  const isForceApiUpdate = !!discoveryResponse?.data?.defi?.isForceUpdate
  const isDebankCallSuccessful = getIsExternalApiDefiPositionsCallSuccessful(discoveryResponse)
  const previousPositionsByProvider = pastPortfolioState?.defiPositions?.positionsByProvider || []
  const debankPositionsByProvider =
    discoveryResponse?.data?.defi?.positions ||
    // Fallback to the old positions if the call failed or was skipped
    previousPositionsByProvider.filter((p) => p.source !== 'custom')
  const { lastForceApiUpdate, lastSuccessfulUpdate } = pastPortfolioState?.defiPositions || {}

  const stkWalletPosition = getStakedWalletPositions(stkWalletToken)

  const uniqueAndMerged = getUniqueMergedPositions(
    debankPositionsByProvider,
    customPositionsByProvider,
    // Ethereum-specific. Add the Staked Wallet token as a defi position
    stkWalletPosition
  )

  return {
    nonceId,
    error: !isDebankCallSuccessful ? DeFiPositionsError.CriticalError : customPositionsError,
    lastSuccessfulUpdate:
      isDebankCallSuccessful && !customPositionsError ? Date.now() : lastSuccessfulUpdate,
    lastForceApiUpdate: isForceApiUpdate ? Date.now() : lastForceApiUpdate,
    providerErrors: customProvidersErrors,
    positionsByProvider: uniqueAndMerged || previousPositionsByProvider
  }
}

/**
 * Formats the response from Debank in a format that is expected by the extension.
 * Invalid positions are excluded from the formatted response.
 */
const getFormattedApiPositions = (result: Omit<PositionsByProvider, 'source'>[]) => {
  return result.map((p) => ({
    ...p,
    source: 'debank' as const,
    chainId: BigInt(p.chainId),
    positions: p.positions
      .map((pos) => {
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
              // Debank returns zero addresses like `0x00` as `ethereum/base` which breaks our logic
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
          console.error('DeFi error when mapping positions: ', error, 'position', pos)
          return null
        }
      })
      .filter(Boolean) as Position[]
  }))
}

/**
 * Enhances the portfolio tokens with Defi position data.
 * Examples:
 * - Marks tokens that are part of a DeFi position with the position ID.
 * - Sets the defiTokenType flag based on the asset type in the DeFi position.
 * - Adjusts token prices for borrowed assets.
 * - Adds missing tokens that are part of DeFi positions but not in the portfolio tokens. This is a very rare
 * case in which the token is not found by Cena/Debank but is part of a custom defi position. Because they are fetched
 * after the portfolio tokens we need to add them here. This is needed only the first time as subsequent requests receive
 * the tokens as hints. (See `getAllAssetsAsHints`)
 */
const enhancePortfolioTokensWithDefiPositions = (
  portfolioTokens: TokenResult[],
  defiPositionsState: PortfolioNetworkResult['defiPositions'] | undefined
): TokenResult[] => {
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
              assetType: AssetType.Collateral,
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
                ({ baseCurrency }: { baseCurrency: string }) => baseCurrency.toLowerCase() === 'usd'
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

              if (protocolAsset.address) {
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
            } else if (
              'address' in protocolAsset &&
              'decimals' in protocolAsset &&
              'symbol' in protocolAsset &&
              'name' in protocolAsset &&
              typeof protocolAsset.decimals === 'number' &&
              typeof protocolAsset.symbol === 'string' &&
              typeof protocolAsset.name === 'string'
            ) {
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
          console.error('Failed to enhance a portfolio token with DeFi position data.', e)
        }
      })
    })

    const enhancedTokenList = portfolioTokens.map((token) => {
      const defiAssetData = defiAssetsMap.get(token.address.toLowerCase())

      if (!defiAssetData) return token

      let priceIn = token.priceIn

      // Remove the prices of borrowed assets
      if (defiAssetData?.assetType === AssetType.Borrow) {
        priceIn = []
      } else if (
        // If the token doesn't have a price in the portfolio but has in the defi state
        // we add it
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
    console.error('Failed to enhance portfolio tokens with DeFi positions.', e)

    return portfolioTokens
  }
}

const getHasNonceChangedSinceLastUpdate = (
  previousState: PortfolioNetworkResult['defiPositions'] | undefined,
  nonceId: string | undefined
): boolean => {
  // First time fetching positions
  if (!previousState || !previousState.nonceId) return false

  return nonceId !== previousState.nonceId
}

/**
 * Whether the portfolio defi positions data should be updated
 */
const getCanSkipUpdate = (
  previousState: PortfolioNetworkResult['defiPositions'] | undefined,
  hasNonceChangedSinceLastUpdate: boolean,
  maxDataAgeMs: number = 60000
): boolean => {
  if (!previousState || !previousState.lastSuccessfulUpdate) return false

  // Always update if the nonce has changed
  if (hasNonceChangedSinceLastUpdate) return false

  return Date.now() - previousState.lastSuccessfulUpdate < maxDataAgeMs
}

const getShouldBypassServerSideCache = (
  previousState: PortfolioNetworkResult['defiPositions'] | undefined,
  isManualUpdate: boolean,
  hasKeys: boolean,
  sessionIds: string[],
  hasNonceChangedSinceLastUpdate: boolean
): boolean => {
  // Always bypass cache if the nonce has changed
  if (hasNonceChangedSinceLastUpdate) return true

  const hasForceApiUpdatePrerequisites = isManualUpdate && sessionIds.length && hasKeys

  if (!hasForceApiUpdatePrerequisites) return false

  // Bypass the server-side cache if the last force update was more than 30s ago
  const HALF_MINUTE_MS = 30000

  return Date.now() - (previousState?.lastForceApiUpdate || 0) >= HALF_MINUTE_MS
}

/**
 * Returns the networks where the account has positions with certainty.
 * Certainty - there are no errors and the rpc is working.
 */
const getAccountNetworksWithPositions = (
  accountId: AccountId,
  accountState: AccountState,
  oldNetworksWithPositionsByAccounts: NetworksWithPositionsByAccounts,
  providers: RPCProviders
): NetworksWithPositions => {
  const networksWithPositions: NetworksWithPositions = {
    ...oldNetworksWithPositionsByAccounts[accountId]
  }

  Object.keys(accountState).forEach((chainId) => {
    const state = accountState[chainId]?.result?.defiPositions
    if (!providers[chainId] || !state) return

    const isRPCDown = !providers[chainId].isWorking
    const { positionsByProvider, error, providerErrors } = state

    // RPC is down or an error occurred
    if (error || isRPCDown || providerErrors?.length) return

    networksWithPositions[chainId] = positionsByProvider.reduce(
      (networksWithPositionsByProviders, provider) => {
        if (networksWithPositionsByProviders.includes(provider.providerName))
          return networksWithPositionsByProviders

        networksWithPositionsByProviders.push(provider.providerName)

        return networksWithPositionsByProviders
      },
      networksWithPositions[chainId] || []
    )
  })

  return networksWithPositions
}

export {
  getAssetValue,
  updatePositionsByProviderAssetPrices,
  getCustomProviderPositions,
  getUniqueMergedPositions,
  getAllAssetsAsHints,
  getNewDefiState,
  getFormattedApiPositions,
  enhancePortfolioTokensWithDefiPositions,
  getCanSkipUpdate,
  getShouldBypassServerSideCache,
  getAccountNetworksWithPositions,
  getHasNonceChangedSinceLastUpdate
}
