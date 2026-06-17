import { Network } from '../../interfaces/network'

// TODO: create a list with fallbacks to prevent downtime
const HELIOS_CONSENSUS_RPC = 'https://lodestar-mainnet.chainsafe.io'

type HeliosNetworkKind = 'ethereum' | 'opstack' | 'linea'
type HeliosNetwork = 'mainnet' | 'op-mainnet' | 'base' | 'linea'
type HeliosConfig = {
  executionRpc: string
  consensusRpc?: string
  network: HeliosNetwork
  dbType: 'config'
}

const HELIOS_CONFIG_BY_CHAIN_ID: Record<
  string,
  { kind: HeliosNetworkKind; network: HeliosNetwork; consensusRpc?: string }
> = {
  '1': { kind: 'ethereum', network: 'mainnet', consensusRpc: HELIOS_CONSENSUS_RPC },
  '10': { kind: 'opstack', network: 'op-mainnet' },
  '8453': { kind: 'opstack', network: 'base' },
  '59144': { kind: 'linea', network: 'linea' }
}

export const isHeliosProviderAvailable = (chainId: Network['chainId']) => {
  return !!HELIOS_CONFIG_BY_CHAIN_ID[chainId.toString()]
}

export const getHeliosProviderConfig = (
  chainId: Network['chainId'],
  executionRpc: string
): { config: HeliosConfig; kind: HeliosNetworkKind } | null => {
  const config = HELIOS_CONFIG_BY_CHAIN_ID[chainId.toString()]

  if (!config) return null

  return {
    kind: config.kind,
    config: {
      executionRpc,
      consensusRpc: config.consensusRpc,
      network: config.network,
      dbType: 'config'
    }
  }
}
