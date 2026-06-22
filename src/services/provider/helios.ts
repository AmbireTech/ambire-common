import { BrowserProvider, JsonRpcApiProviderOptions, Network } from 'ethers'

import { RPCProvider } from '@/interfaces/provider'
import { getProviderConnectionUrl, getRpcProvider } from '@/services/provider/getRpcProvider'
import { helios } from '@kohaku-eth/provider/helios'

import { Network as NetworkInterface } from '../../interfaces/network'
import { getHeliosProviderConfig } from '../../libs/networks/helios'

export const getHeliosRpcProvider = async (
  network: NetworkInterface,
  options?: JsonRpcApiProviderOptions
): Promise<RPCProvider> => {
  const heliosConfig = getHeliosProviderConfig(network.chainId, network.selectedRpcUrl)

  if (!heliosConfig) {
    return getRpcProvider(network.rpcUrls, network.chainId, network.selectedRpcUrl, options)
  }

  const kohakuProvider = await helios(heliosConfig.config, heliosConfig.kind, true)
  const staticNetwork = Network.from(Number(network.chainId))
  const provider = new BrowserProvider(kohakuProvider, staticNetwork) as unknown as RPCProvider
  const browserProviderDestroy = provider.destroy.bind(provider)

  ;(provider as any)._getConnection = () => ({ url: getProviderConnectionUrl(network) })
  provider.destroy = () => {
    browserProviderDestroy()
    void kohakuProvider._internal.destroy()
  }

  return provider
}
