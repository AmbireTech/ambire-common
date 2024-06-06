export type NetworkId = string

export interface Erc4337settings {
  enabled: boolean
  hasPaymaster: boolean
  explorerId?: string // what is the network id according to the explorer
}

interface FeeOptions {
  is1559: boolean
  minBaseFee?: bigint
  elasticityMultiplier?: bigint
  baseFeeMaxChangeDenominator?: bigint
  feeIncrease?: bigint // should we increase the relayer fee in %
  maxPriorityFee?: bigint
}

export interface NetworkInfo {
  chainId: bigint
  isSAEnabled: boolean
  hasSingleton: boolean
  isOptimistic: boolean
  rpcNoStateOverride: boolean
  erc4337: { enabled: boolean; hasPaymaster: boolean }
  areContractsDeployed: boolean
  feeOptions: { is1559: boolean } | null
  hasDebugTraceCall: boolean
  platformId: string
  nativeAssetId: string
  flagged: boolean
}

export type NetworkInfoLoading<T> = {
  [K in keyof T]: T[K] | 'LOADING'
}

export interface NetworkFeature {
  id: string
  title: string
  msg?: string
  level: 'success' | 'danger' | 'warning' | 'loading' | 'initial'
}
export interface Network {
  id: NetworkId
  name: string
  nativeAssetSymbol: string
  chainId: bigint
  rpcUrls: string[]
  explorerUrl: string
  selectedRpcUrl: string
  erc4337: Erc4337settings
  rpcNoStateOverride: boolean
  feeOptions: FeeOptions
  isSAEnabled: boolean
  areContractsDeployed: boolean
  features: NetworkFeature[]
  hasRelayer: boolean
  hasSingleton: boolean
  hasDebugTraceCall: boolean
  platformId: string
  nativeAssetId: string
  iconUrls?: string[]
  reestimateOn?: number
  isOptimistic?: boolean
  flagged?: boolean
  predefined: boolean
}

export interface AddNetworkRequestParams {
  name: Network['name']
  rpcUrls: Network['rpcUrls']
  selectedRpcUrl: Network['selectedRpcUrl']
  chainId: Network['chainId']
  nativeAssetSymbol: Network['nativeAssetSymbol']
  explorerUrl: Network['explorerUrl']
  iconUrls: Network['iconUrls']
}
