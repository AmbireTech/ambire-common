export type NetworkId = string

export interface Erc4337settings {
  enabled: boolean
  hasPaymaster: boolean
  // what is the network id according to the explorer
  explorerId?: string
}

interface FeeOptions {
  is1559: boolean
  minBaseFee?: bigint
  elasticityMultiplier?: bigint
  baseFeeMaxChangeDenominator?: bigint
  // should we increase the relayer fee in %
  feeIncrease?: bigint
  maxPriorityFee?: bigint
}

export type NetworkInfo = {
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

export type NetworkFeature = {
  id: string
  title: string
  msg?: string
  level: 'success' | 'danger' | 'warning' | 'loading'
}

// NetworkId is a string: this is our internal identifier for the network
// chainId is a number and is the chainID used for replay protection (EIP-155)
// we need this distinction because:
// 1) it's easier to work with the string identifier, for example if we have an object segmented by networks it's easier to debug with string IDs
// 2) multiple distinct networks may (rarely) run the same chainId
export interface NetworkDescriptor {
  id: NetworkId
  name: string
  nativeAssetSymbol: string
  chainId: bigint
  rpcUrls: string[]
  explorerUrl: string
  erc4337: Erc4337settings
  rpcNoStateOverride: boolean
  unstoppableDomainsChain: string
  feeOptions: FeeOptions
  isSAEnabled: boolean
  areContractsDeployed: boolean
  reestimateOn?: number
  isOptimistic?: boolean
  features: NetworkFeature[]
  hasRelayer: boolean
  hasSingleton: boolean
  hasDebugTraceCall: boolean
  platformId: string
  nativeAssetId: string
  flagged?: boolean
  // NOTE: should this be here? keep in mind networks can be user-inputted, so it's prob better to have
  // a separate mapping somewhere
  // @TODO remove this, add a separate mapping
  // coingeckoPlatformId: string
}
