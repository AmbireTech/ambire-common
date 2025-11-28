import { JsonRpcProvider, Network } from 'ethers'

import { Network as NetworkInterface } from '../../interfaces/network'
import getRootDomain from '../../utils/getRootDomain'

interface ProviderOptions {
  batchMaxCount: number
}

const RPC_BATCH_CONFIG: Record<string, number> = {
  'drpc.org': 3, // batch of more than 3 requests are not allowed on free tier (response 500 with internal code 31)
  '1rpc.io': 3, // batch of more than 3 requests are not allowed on free tier (response 500 with internal code 31)
  'roninchain.com': 3 // batch of more than 3 results in response 400 with "too many requests"
  // Keep tatum.io config disabled - if restricted to 1 it hits their limit of 5 requests per minute anyways
  // 'tatum.io': 1 // batch calls are available for paid plans only (response 402)
}

/** Some RPCs limit batching which causes immediate failures on our end, so configure the known ones */
const getBatchCountFromUrl = (rpcUrl: string, chainId?: bigint | number): number | undefined => {
  try {
    // hardcode a max batch size of 3 for test networks
    if (chainId && (chainId === 11155420n || chainId === 421614n || chainId === 84532n)) {
      return 3
    }

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
  options?: ProviderOptions
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

  const batchMaxCount = getBatchCountFromUrl(rpcUrl, chainId)
  const providerOptions = batchMaxCount ? { ...options, batchMaxCount } : options

  if (chainId) {
    const staticNetwork = Network.from(Number(chainId))

    if (staticNetwork) {
      return new JsonRpcProvider(rpcUrl, staticNetwork, { staticNetwork, ...providerOptions })
    }
  }

  return new JsonRpcProvider(rpcUrl, undefined, providerOptions)
}

export { getRpcProvider }
