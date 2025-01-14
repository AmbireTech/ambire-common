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
