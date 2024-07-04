import { ZeroAddress } from 'ethers'

import { Network } from '../interfaces/network'

// @TODO some form of a constants list
export function geckoIdMapper(address: string, network: Network): string | null {
  if (address === ZeroAddress) return network.nativeAssetId

  // we currently can't map aave so we're leaving this
  if (address === '0x4da27a545c0c5B758a6BA100e3a049001de870f5') return 'aave'

  return null
}
