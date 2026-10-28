import { getAddress, isAddress } from 'ethers'

import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { CustomResponse, Fetch } from '../../interfaces/fetch'
import { SwapAndBridgeToToken } from '../../interfaces/swapAndBridge'
import { fetchWithTimeout } from '../../utils/fetch'

export const CENA_API_BASE_URL = 'https://cena.ambire.com'

const CENA_REQUEST_TIMEOUT_MS = 15000

const ERROR_PREFIX = 'Unable to retrieve token information by address.'

type CenaTokenResponse = {
  blacklist?: boolean
  decimals?: Record<string, number>
  image?: {
    large?: string
    small?: string
    thumb?: string
  }
  name?: string
  /** The platform that Cena matched the requested chain to */
  platformId?: string
  platforms?: Record<string, string>
  removed?: boolean
  symbol?: string
}

const fetchFromCena = async (fetch: Fetch, url: string): Promise<CustomResponse> => {
  try {
    return await fetchWithTimeout(
      fetch,
      url,
      { headers: { Accept: 'application/json', 'Content-Type': 'application/json' } },
      CENA_REQUEST_TIMEOUT_MS
    )
  } catch (error: any) {
    if (error?.message === 'request-timeout') {
      throw new SwapAndBridgeProviderApiError(
        `${ERROR_PREFIX} Our token information service is temporarily unavailable or your internet connection is too slow.`
      )
    }

    throw new SwapAndBridgeProviderApiError(
      `${ERROR_PREFIX} Our token information service could not be reached. Error details: <${
        error?.message || 'no message'
      }>`
    )
  }
}

const parseResponse = async <T>(response: CustomResponse): Promise<T> => {
  let body: T
  try {
    body = await response.json()
  } catch (error: any) {
    throw new SwapAndBridgeProviderApiError(
      `${ERROR_PREFIX} Our token information service returned an unexpected response. Error details: <${
        error?.message || 'no message'
      }>`
    )
  }

  if (!response.ok) {
    throw new SwapAndBridgeProviderApiError(
      `${ERROR_PREFIX} Our token information service responded with an error (${response.status}).`
    )
  }

  return body
}

/**
 * Looks up the metadata (name, symbol, decimals, icon) of a token by its address and chain in Cena.
 * Returns null when Cena does not know the token or the response cannot be trusted
 * (blacklisted or removed token, or a contract that differs from the requested one).
 */
export const getTokenByAddress = async ({
  fetch,
  address,
  chainId
}: {
  fetch: Fetch
  address: string
  chainId: number
}): Promise<SwapAndBridgeToToken | null> => {
  if (!isAddress(address)) return null

  const normalizedAddress = getAddress(address)

  const tokenResponse = await fetchFromCena(
    fetch,
    `${CENA_API_BASE_URL}/api/v3/coins/${chainId}/contract/${normalizedAddress}`
  )
  if (tokenResponse.status === 404) return null
  const token = await parseResponse<CenaTokenResponse>(tokenResponse)
  // A coin can have the same address on several platforms, with different decimals. The
  // decimals must be the ones of the platform that Cena matched to the requested chain
  const { platformId } = token
  if (typeof platformId !== 'string' || !platformId) return null

  const platformAddress = token.platforms?.[platformId]
  const decimals = token.decimals?.[platformId]

  if (
    token.blacklist ||
    token.removed ||
    !platformAddress ||
    !isAddress(platformAddress) ||
    platformAddress.toLowerCase() !== normalizedAddress.toLowerCase() ||
    !Number.isInteger(decimals) ||
    decimals === undefined ||
    decimals < 0 ||
    decimals > 255 ||
    typeof token.name !== 'string' ||
    !token.name ||
    typeof token.symbol !== 'string' ||
    !token.symbol
  )
    return null

  return {
    address: normalizedAddress,
    chainId,
    decimals,
    icon: token.image?.large || token.image?.small || token.image?.thumb || '',
    name: token.name,
    symbol: token.symbol
  }
}
