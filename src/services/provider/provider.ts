import { NetworkId } from '../../constants/networks'

// Provider instances by a network id
// For instance: { 'ethereum': new providers.StaticJsonRpcProvider }
let rpcProviders: { [key in NetworkId]: any }

export const initRpcProviders = (providers: { [key in NetworkId]: any }) => {
  rpcProviders = providers
}

export function getProvider(networkId: NetworkId) {
  const providersByNetwork = rpcProviders ? rpcProviders[networkId] : null

  if (!providersByNetwork)
    throw new Error(`getProvider called with non-existent provider for network: ${networkId}`)

  return providersByNetwork
}
