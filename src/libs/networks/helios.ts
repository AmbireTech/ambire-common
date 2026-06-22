import { Network } from '../../interfaces/network'

type HeliosNetworkKind = 'ethereum' | 'opstack' | 'linea'
type HeliosNetwork = 'mainnet' | 'op-mainnet' | 'base' | 'linea'
type HeliosConfig = {
  executionRpc: string
  consensusRpc?: string
  verifiableApi?: string
  network: HeliosNetwork
  dbType: 'config'
}

const HELIOS_CONFIG_BY_CHAIN_ID: Record<
  string,
  {
    kind: HeliosNetworkKind
    network: HeliosNetwork
    syncUrlConfigKey?: 'consensusRpc' | 'verifiableApi'
  }
> = {
  '1': { kind: 'ethereum', network: 'mainnet', syncUrlConfigKey: 'consensusRpc' },
  '10': { kind: 'opstack', network: 'op-mainnet', syncUrlConfigKey: 'verifiableApi' },
  '8453': { kind: 'opstack', network: 'base', syncUrlConfigKey: 'verifiableApi' },
  '59144': { kind: 'linea', network: 'linea' }
}

export const isHeliosProviderAvailable = (chainId: Network['chainId']) => {
  return !!HELIOS_CONFIG_BY_CHAIN_ID[chainId.toString()]
}

export const getHeliosProviderConfig = (
  chainId: Network['chainId'],
  executionRpc: string,
  heliosRpcUrl: string
): { config: HeliosConfig; kind: HeliosNetworkKind } | null => {
  const config = HELIOS_CONFIG_BY_CHAIN_ID[chainId.toString()]

  if (!config) return null

  const heliosConfig: HeliosConfig = {
    executionRpc,
    network: config.network,
    dbType: 'config'
  }

  if (config.syncUrlConfigKey) {
    heliosConfig[config.syncUrlConfigKey] = heliosRpcUrl
  }

  return {
    kind: config.kind,
    config: heliosConfig
  }
}
