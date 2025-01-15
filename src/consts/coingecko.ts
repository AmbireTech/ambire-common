import { ZeroAddress } from 'ethers'

import { Network } from '../interfaces/network'
import { WALLET_STAKING_ADDR, WALLET_TOKEN } from './addresses'

const COINGECKO_API_BASE_URL = 'https://api.coingecko.com/api/v3/coins/'

// @TODO some form of a constants list
export function geckoIdMapper(address: string, network: Network): string | null {
  if (address === ZeroAddress) return network.nativeAssetId

  // we currently can't map aave so we're leaving this
  if (address === '0x4da27a545c0c5B758a6BA100e3a049001de870f5') return 'aave'

  return null
}

/**
 * Maps specific token addresses to alternative addresses if they are missing on
 * CoinGecko (so that they are aliased to existing tokens).
 */
export function geckoTokenAddressMapper(address: string) {
  // xWALLET is missing on CoinGecko, so alias it to WALLET token (that exists on CoinGecko)
  if (address === WALLET_STAKING_ADDR) return WALLET_TOKEN

  return address
}

/**
 * Constructs the CoinGecko API URL for a given token address and network ID.
 * Handles special cases where the CoinGecko API does not correctly handle
 * certain tokens like native tokens on some networks.
 */
export function getCoinGeckoTokenApiUrl(tokenAddress: string, geckoNetworkId: string) {
  // Exception because the CoinGecko API doesn't handle these cases correctly.
  // Alias them to the ETH on Ethereum URL, so a valid URL is returned.
  const isNativeTokenOnNetworksThatHaveEthAsNative =
    tokenAddress === ZeroAddress &&
    ['optimistic-ethereum', 'base', 'arbitrum-one'].includes(geckoNetworkId)
  if (isNativeTokenOnNetworksThatHaveEthAsNative) return `${COINGECKO_API_BASE_URL}ethereum`

  // CoinGecko does not handle native assets (ETH, MATIC, BNB...) via the /contract endpoint.
  // Instead, native assets are identified by the `geckoNetworkId` directly.
  if (tokenAddress === ZeroAddress) return `${COINGECKO_API_BASE_URL}${geckoNetworkId}`

  const geckoTokenAddress = geckoTokenAddressMapper(tokenAddress)
  return `${COINGECKO_API_BASE_URL}${geckoNetworkId}/contact/${geckoTokenAddress}`
}
