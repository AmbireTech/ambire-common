import { BrowserProvider, JsonRpcApiProviderOptions, JsonRpcProvider, Network } from 'ethers'
import { helios } from '@kohaku-eth/provider/helios'
import { createPublicClient, custom, PublicClient } from 'viem'

import { Network as NetworkInterface } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { getHeliosProviderConfig, isHeliosProviderAvailable } from '../../libs/networks/helios'
import getRootDomain from '../../utils/getRootDomain'

const RPC_BATCH_CONFIG: Record<string, number> = {
  'drpc.org': 3, // batch of more than 3 requests are not allowed on free tier (response 500 with internal code 31)
  '1rpc.io': 3, // batch of more than 3 requests are not allowed on free tier (response 500 with internal code 31)
  'roninchain.com': 3 // batch of more than 3 results in response 400 with "too many requests"
  // Keep tatum.io config disabled - if restricted to 1 it hits their limit of 5 requests per minute anyways
  // 'tatum.io': 1 // batch calls are available for paid plans only (response 402)
}

const viemClientByProvider = new WeakMap<RPCProvider, PublicClient>()

/** Some RPCs limit batching which causes immediate failures on our end, so configure the known ones */
const getBatchCountFromUrl = (rpcUrl: string): number | undefined => {
  try {
    const rootDomain = getRootDomain(rpcUrl)
    return RPC_BATCH_CONFIG[rootDomain]
  } catch {
    return undefined
  }
}

const getRpcProvider = (
  rpcUrls: NetworkInterface['rpcUrls'],
  chainId?: bigint | number,
  selectedRpcUrl?: string,
  options?: JsonRpcApiProviderOptions
) => {
  if (!rpcUrls.length) {
    throw new Error('rpcUrls must be a non-empty array')
  }

  let rpcUrl = rpcUrls[0]

  if (selectedRpcUrl) {
    const prefUrl = rpcUrls.find((u) => u === selectedRpcUrl)
    if (prefUrl) rpcUrl = prefUrl
  }

  if (!rpcUrl) {
    throw new Error('Invalid RPC URL provided')
  }

  const batchMaxCount = getBatchCountFromUrl(rpcUrl)
  const providerOptions = batchMaxCount ? { ...options, batchMaxCount } : options

  if (chainId) {
    const staticNetwork = Network.from(Number(chainId))

    if (staticNetwork) {
      return new JsonRpcProvider(rpcUrl, staticNetwork, { staticNetwork, ...providerOptions })
    }
  }

  return new JsonRpcProvider(rpcUrl, undefined, providerOptions)
}

const getProviderConnectionUrl = (network: NetworkInterface) => {
  return network.useHeliosProvider && isHeliosProviderAvailable(network.chainId)
    ? `helios:${network.selectedRpcUrl}`
    : network.selectedRpcUrl
}

const getHeliosRpcProvider = async (
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

const getViemClientForProvider = (provider: RPCProvider): PublicClient => {
  const cached = viemClientByProvider.get(provider)
  if (cached) return cached

  const client = createPublicClient({
    transport: custom({
      request: ({ method, params }) => provider.send(method, params || [])
    })
  })

  viemClientByProvider.set(provider, client)
  return client
}

export { getHeliosRpcProvider, getProviderConnectionUrl, getRpcProvider, getViemClientForProvider }
