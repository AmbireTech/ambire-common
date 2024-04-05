import { JsonRpcProvider, Network } from 'ethers'

import { NetworkDescriptor } from '../../interfaces/networkDescriptor'

const getRpcProvider = (
  rpcUrls: NetworkDescriptor['rpcUrls'],
  chainId?: bigint | number,
  selectedRpcUrl?: string
) => {
  if (!rpcUrls.length) {
    throw new Error('rpcUrls must be a non-empty array')
  }

  let rpcUrl = rpcUrls[0]

  if (selectedRpcUrl) {
    const prefUrl = rpcUrls.find((u) => u === selectedRpcUrl)
    if (prefUrl) rpcUrl = prefUrl
  }

  if (chainId) {
    const staticNetwork = Network.from(Number(chainId))

    if (staticNetwork) {
      return new JsonRpcProvider(rpcUrl, staticNetwork, { staticNetwork })
    }
  }

  console.log('rpcUrl', rpcUrl)
  return new JsonRpcProvider(rpcUrl)
}

export { getRpcProvider }
