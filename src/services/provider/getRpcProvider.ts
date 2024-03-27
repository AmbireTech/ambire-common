import { JsonRpcProvider, Networkish } from 'ethers'

import { NetworkDescriptor } from '../../interfaces/networkDescriptor'

const getRpcProvider = (
  rpcUrls: NetworkDescriptor['rpcUrls'],
  network?: Networkish,
  preferredRpcUrl?: string
) => {
  if (!rpcUrls.length) {
    throw new Error('rpcUrls must be a non-empty array')
  }

  let rpcUrl = rpcUrls[0]

  if (preferredRpcUrl) {
    const prefUrl = rpcUrls.find((u) => u === preferredRpcUrl)
    if (prefUrl) rpcUrl = prefUrl
  }

  return new JsonRpcProvider(rpcUrl, network)
}

export { getRpcProvider }
