import { JsonRpcProvider, Network } from 'ethers'

import { NetworkDescriptor } from '../../interfaces/networkDescriptor'

const getRpcProvider = (
  rpcUrls: NetworkDescriptor['rpcUrls'],
  chainId?: bigint | number,
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

  if (chainId) {
    const staticNetwork = Network.from(Number(chainId))

    if (staticNetwork) {
      return new JsonRpcProvider(rpcUrl, staticNetwork, { staticNetwork })
    }
  }

  return new JsonRpcProvider(rpcUrl)
}

export { getRpcProvider }
