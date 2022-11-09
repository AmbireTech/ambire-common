import { NetworkId } from '../../constants/networks'

// Provider instances by a network id
// For instance: { 'ethereum': new providers.StaticJsonRpcProvider }
let rpcProviders: any = {}

export const initRpcProviders = (providers: { [key in NetworkId]: any }) => {
  rpcProviders = providers
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
