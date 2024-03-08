import { NetworkId } from '../../constants/networks'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'

// Provider instances by a network id
// For instance: { 'ethereum': new providers.StaticJsonRpcProvider }
let rpcProviders: any = {}

export const initRpcProviders = (providers: Partial<{ [ key in NetworkId ]: any }>) => {
  rpcProviders = providers
}
export const areRpcProvidersInitialized = () => {
  return !!Object.keys(rpcProviders).length
}


export function getProvider(networkId: NetworkDescriptor['id']) {
  const providersByNetwork = rpcProviders[networkId]

  if (!providersByNetwork) {
    console.error(
      `getProvider called with non-existent provider for network: ${networkId}. Initialize providers before calling getProvider`
    )
  }

  return providersByNetwork
}
