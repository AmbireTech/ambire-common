import { FallbackProvider, JsonRpcProvider, Networkish } from 'ethers'

import { NetworkDescriptor } from '../../interfaces/networkDescriptor'

const getRpcProvider = (rpcUrls: NetworkDescriptor['rpcUrls'], network?: Networkish) => {
  if (!rpcUrls.length) {
    throw new Error('rpcUrls must be a non-empty array')
  }

  if (rpcUrls.length === 1) {
    return new JsonRpcProvider(rpcUrls[0], network)
  }

  const providers = rpcUrls.map((url) => new JsonRpcProvider(url))
  return new FallbackProvider(providers, network, {
    quorum: providers.length <= 2 ? 1 : 2
  })
}

export { getRpcProvider }
