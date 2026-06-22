import { Config as HeliosConfig, createHeliosProvider } from '@a16z/helios'
import { BrowserProvider, JsonRpcApiProviderOptions, Network } from 'ethers'

import { RPCProvider } from '@/interfaces/provider'
import { getProviderConnectionUrl, getRpcProvider } from '@/services/provider/getRpcProvider'

import { Network as NetworkInterface } from '../../interfaces/network'
import { getHeliosProviderConfig } from '../../libs/networks/helios'

const getProviderWithBypassedLogs = (heliosProvider: any, config: HeliosConfig) => {
  let nextId = 1
  let isDestroyed = false

  const destroy = () => {
    if (isDestroyed) return

    isDestroyed = true
    void heliosProvider.destroy()
  }

  return {
    provider: {
      request: async ({ method, params }: { method: string; params?: any[] }) => {
        try {
          if (method !== 'eth_getLogs') {
            return await heliosProvider.request({ method, params })
          }

          const response = await fetch(config.executionRpc!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })
          })
          const { result, error } = await response.json()

          if (error) throw new Error(error.message)

          return result
        } catch (error) {
          destroy()
          throw error
        }
      }
    },
    destroy
  }
}

export const getHeliosRpcProvider = async (
  network: NetworkInterface,
  options?: JsonRpcApiProviderOptions
): Promise<RPCProvider> => {
  const heliosRpcUrl = network.heliosRpcUrl?.trim()
  const heliosConfig = heliosRpcUrl
    ? getHeliosProviderConfig(network.chainId, network.selectedRpcUrl, heliosRpcUrl)
    : null

  if (!heliosConfig) {
    return getRpcProvider(network.rpcUrls, network.chainId, network.selectedRpcUrl, options)
  }

  const heliosProvider = await createHeliosProvider(heliosConfig.config, heliosConfig.kind)
  const eip1193Provider = getProviderWithBypassedLogs(heliosProvider, heliosConfig.config)
  const staticNetwork = Network.from(Number(network.chainId))
  const provider = new BrowserProvider(
    eip1193Provider.provider,
    staticNetwork
  ) as unknown as RPCProvider
  const browserProviderDestroy = provider.destroy.bind(provider)

  ;(provider as any)._getConnection = () => ({ url: getProviderConnectionUrl(network) })
  provider.destroy = () => {
    browserProviderDestroy()
    eip1193Provider.destroy()
  }

  return provider
}
