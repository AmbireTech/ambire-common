import { ZeroAddress } from 'ethers'

import { Network } from '../interfaces/network'
import { WALLET_STAKING_ADDR, WALLET_TOKEN } from './addresses'

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

const COINGECKO_COINS_API_URL = 'https://api.coingecko.com/api/v3/coins/'

export function getGeckoTokenCoinsApiUrl(tokenAddress: string, geckoNetworkId: string) {
  // Exception because the CoinGecko API doesn't handle these cases correctly.
  // Alias them to the ETH on Ethereum URL, so a valid URL is returned.
  const isNativeTokenOnNetworksThatHaveEthAsNative =
    tokenAddress === ZeroAddress &&
    ['optimistic-ethereum', 'base', 'arbitrum-one'].includes(geckoNetworkId)
  if (isNativeTokenOnNetworksThatHaveEthAsNative) return `${COINGECKO_COINS_API_URL}ethereum`

  // CoinGecko does not handle native assets (ETH, MATIC, BNB...) via the /contract endpoint.
  // Instead, native assets are identified by the `geckoNetworkId` directly.
  if (tokenAddress === ZeroAddress) return `${COINGECKO_COINS_API_URL}${geckoNetworkId}`

  const geckoTokenAddress = geckoTokenAddressMapper(tokenAddress)
  return `${COINGECKO_COINS_API_URL}${geckoNetworkId}/contact/${geckoTokenAddress}`
}
