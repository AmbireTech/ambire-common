import { providers } from 'ethers'

import networks, { NetworkId } from '../../constants/networks'

// Cache provider instances by a network id
// For instance: { 'ethereum': new providers.StaticJsonRpcProvider }
const providersByNetwork: any = {}

export function getProvider(networkId: NetworkId) {
  const network = networks.find(({ id }) => id === networkId)
  if (!network) throw new Error(`getProvider called with non-existent network: ${networkId}`)

  // If the provider instance is already created, just reuse the cached instance,
  // instead of creating the same object again.
  if (providersByNetwork[networkId]) return providersByNetwork[networkId]

  const { id: name, chainId, ensName } = network
  const url = network.rpc

  if (url.startsWith('wss:')) {
    providersByNetwork[networkId] = new providers.WebSocketProvider(url, {
      name: ensName || name,
      chainId
    })
  } else {
    providersByNetwork[networkId] = new providers.StaticJsonRpcProvider(url, {
      name: ensName || name,
      chainId
    })
  }

  return providersByNetwork[networkId]
}
