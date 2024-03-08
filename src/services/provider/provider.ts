import { NetworkId } from '../../constants/networks'

// Provider instances by a network id
// For instance: { 'ethereum': new providers.StaticJsonRpcProvider }
let rpcProviders: any = {}

export const initRpcProviders = (providers: Partial<{ [key in NetworkId]: any }>) => {
  rpcProviders = providers
}

export const areRpcProvidersInitialized = () => {
  return !!Object.keys(rpcProviders).length
}

export function getProvider(networkId: NetworkId) {
  const providersByNetwork = rpcProviders[networkId]

  if (!providersByNetwork) {
    console.error(
      `getProvider called with non-existent provider for network: ${networkId}. Initialize providers before calling getProvider`
    )
  }

  return providersByNetwork
}
