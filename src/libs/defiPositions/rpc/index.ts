import { ITokenPricesController } from '../../../interfaces/tokenPrices'
import { getProviderId } from '../helpers'
import { DeFiPositionsError, PositionsByProvider, ProviderError } from '../types'
import { aaveV3DefiProvider } from './aaveV3/aaveV3'
import { updatePositionsByProviderAssetPrices } from './prices'
import { RpcDefiPositionsResult, RpcDefiProvider, RpcFetchParams } from './types'
import { uniswapV3DefiProvider } from './uniswapV3/uniswapV3'

/**
 * Protocols that the API (Velcro/Debank) returns too, but whose positions are read from the
 * chain even when auto discovery is on, as the chain has data the API lacks or gets wrong
 * (e.g. whether a Uniswap V3 position is in range). With auto discovery on, they are read in
 * parallel with the portfolio and merged with the API data.
 */
export const ALWAYS_FETCHED_PROVIDERS: RpcDefiProvider[] = [
  aaveV3DefiProvider,
  uniswapV3DefiProvider
]

/**
 * Protocols that the API returns fully, so their positions are read from the chain only when
 * auto discovery is off.
 */
export const FETCHED_WITHOUT_API_PROVIDERS: RpcDefiProvider[] = []

const getProvidersToFetch = (isAutoDiscoveryEnabled: boolean): RpcDefiProvider[] => {
  if (isAutoDiscoveryEnabled) return ALWAYS_FETCHED_PROVIDERS

  return [...ALWAYS_FETCHED_PROVIDERS, ...FETCHED_WITHOUT_API_PROVIDERS]
}

const findPositionsOfProvider = (
  positionsByProvider: PositionsByProvider[],
  providerName: string
): PositionsByProvider | undefined =>
  positionsByProvider.find((p) => getProviderId(p.providerName) === getProviderId(providerName))

/**
 * Reads the positions of a protocol from the chain and, if auto discovery is on, merges them
 * with the positions of the same protocol returned by the API.
 */
const fetchProviderPositions = async (
  rpcDefiProvider: RpcDefiProvider,
  params: RpcFetchParams,
  apiPositionsByProvider: PositionsByProvider[] | null
): Promise<PositionsByProvider | null> => {
  const rpcPositions = await rpcDefiProvider.fetchPositions(params)
  if (!rpcPositions || !apiPositionsByProvider || !rpcDefiProvider.mergeWithApiPositions)
    return rpcPositions

  const apiPositions = findPositionsOfProvider(apiPositionsByProvider, rpcDefiProvider.name)
  // If we can't find matching positions from the API, return the ones read from the chain
  if (!apiPositions) return rpcPositions

  return rpcDefiProvider.mergeWithApiPositions({ rpcPositions, apiPositions })
}

/**
 * Returns the positions read from the chain in the previous update by the providers that failed
 * in this one. This is done so the user doesn't lose their positions when the new update fails.
 * A provider that succeeded with no positions means the user closed them, so its previous
 * positions are dropped.
 */
const getPreviousPositionsOfFailedProviders = (
  previousPositions: PositionsByProvider[],
  providerErrors: ProviderError[]
): PositionsByProvider[] =>
  previousPositions.filter(
    (prev) =>
      prev.source === 'custom' &&
      providerErrors.some((e) => getProviderId(e.providerName) === getProviderId(prev.providerName))
  )

/**
 * Prices the assets of the positions that are left without a price (e.g. a new Uniswap V3
 * position Debank doesn't know about yet) through the token prices controller.
 */
const priceRpcDefiPositions = async (
  tokenPrices: ITokenPricesController,
  {
    network,
    accountAddr,
    rpcPositions
  }: {
    network: RpcFetchParams['network']
    accountAddr: string
    rpcPositions: RpcDefiPositionsResult
  }
): Promise<RpcDefiPositionsResult> => {
  const { positionsByProvider, error } = await updatePositionsByProviderAssetPrices(tokenPrices, {
    network,
    positionsByProvider: rpcPositions.positionsByProvider
  })

  if (!error) return { ...rpcPositions, positionsByProvider }

  console.error(`#setAssetPrices error for ${accountAddr} on ${network.name}:`, error)

  return {
    ...rpcPositions,
    positionsByProvider,
    // A critical error of the positions call is more important than a missing price
    error: rpcPositions.error || DeFiPositionsError.AssetPriceError
  }
}

/**
 * Reads the DeFi positions of the protocols in `ALWAYS_FETCHED_PROVIDERS` (and, with auto
 * discovery off, `FETCHED_WITHOUT_API_PROVIDERS`) from the chain, on ENABLED networks only.
 *
 * With auto discovery on, the positions are merged with the API ones where the protocol
 * supports it (e.g. Uniswap V3). If the API call failed or was skipped, the API positions of
 * the previous update are used instead. With auto discovery off, there is no API data, so
 * the positions read from the chain are returned as they are.
 *
 * The positions of a provider whose call fails are taken from the previous update, and assets
 * left without a price are priced through the token prices controller.
 */
const getRpcDefiPositions = async (
  tokenPrices: ITokenPricesController,
  {
    accountAddr,
    provider,
    network,
    previousPositions,
    apiPositions,
    isAutoDiscoveryEnabled
  }: RpcFetchParams & {
    previousPositions: PositionsByProvider[]
    /** The positions returned by the API in this update, if it was called and succeeded */
    apiPositions: PositionsByProvider[] | undefined
    isAutoDiscoveryEnabled: boolean
  }
): Promise<RpcDefiPositionsResult> => {
  if (network.disabled)
    return {
      positionsByProvider: [],
      providerErrors: []
    }

  const apiPositionsToMergeWith = isAutoDiscoveryEnabled
    ? // Fallback to the old API positions if the call failed or was skipped
      apiPositions || previousPositions.filter((p) => p.source !== 'custom')
    : null

  let rpcPositions: RpcDefiPositionsResult

  try {
    const providerErrors: ProviderError[] = []

    const newPositions = (
      await Promise.all(
        getProvidersToFetch(isAutoDiscoveryEnabled).map((rpcDefiProvider) =>
          fetchProviderPositions(
            rpcDefiProvider,
            { accountAddr, provider, network },
            apiPositionsToMergeWith
          ).catch((e: any) => {
            providerErrors.push({
              providerName: rpcDefiProvider.name,
              error: e?.message || 'Unknown error'
            })

            return null
          })
        )
      )
    ).filter((positions): positions is PositionsByProvider => !!positions)

    rpcPositions = {
      positionsByProvider: [
        ...getPreviousPositionsOfFailedProviders(previousPositions, providerErrors),
        ...newPositions
      ],
      providerErrors,
      error: null
    }
  } catch (e: any) {
    console.error('Critical error fetching custom defi positions:', e)
    rpcPositions = {
      positionsByProvider: previousPositions.filter((p) => p.source === 'custom'),
      providerErrors: [],
      error: DeFiPositionsError.CriticalError
    }
  }

  return priceRpcDefiPositions(tokenPrices, { network, accountAddr, rpcPositions })
}

export { getRpcDefiPositions, priceRpcDefiPositions }
