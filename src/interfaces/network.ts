import { BUNDLER } from '../consts/bundlers'

export type NetworkId = string

export interface Erc4337settings {
  enabled: boolean
  hasPaymaster: boolean
  hasBundlerSupport?: boolean
  bundlers?: BUNDLER[]
  defaultBundler?: BUNDLER
}

interface FeeOptions {
  is1559: boolean
  minBaseFee?: bigint
  elasticityMultiplier?: bigint
  baseFeeMaxChangeDenominator?: bigint
  feeIncrease?: bigint // should we increase the relayer fee in %
  // transactions on Base get stuck on slow as we lower the baseFee a lot
  // so we make the minBaseFee the same as the last block one
  minBaseFeeEqualToLastBlock?: boolean
}

export interface NetworkInfo {
  force4337?: boolean
  chainId: bigint
  isSAEnabled: boolean
  hasSingleton: boolean
  isOptimistic: boolean
  rpcNoStateOverride: boolean
  erc4337: Erc4337settings
  areContractsDeployed: boolean
  feeOptions: FeeOptions
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

// NetworkId is a string: this is our internal identifier for the network
// chainId is a number and is the chainID used for replay protection (EIP-155)
// we need this distinction because:
// 1) it's easier to work with the string identifier, for example if we have an object segmented by networks it's easier to debug with string IDs
// 2) multiple distinct networks may (rarely) run the same chainId
export interface Network {
  id: NetworkId
  name: string
  nativeAssetSymbol: string
  chainId: NetworkInfo['chainId']
  rpcUrls: string[]
  explorerUrl: string
  selectedRpcUrl: string
  erc4337: NetworkInfo['erc4337']
  rpcNoStateOverride: NetworkInfo['rpcNoStateOverride']
  feeOptions: NetworkInfo['feeOptions']
  isSAEnabled: NetworkInfo['isSAEnabled']
  areContractsDeployed: NetworkInfo['areContractsDeployed']
  features: NetworkFeature[]
  hasRelayer: boolean
  hasSingleton: NetworkInfo['hasSingleton']
  platformId: NetworkInfo['platformId']
  nativeAssetId: NetworkInfo['nativeAssetId']
  iconUrls?: string[]
  reestimateOn?: number
  isOptimistic?: NetworkInfo['isOptimistic']
  flagged?: NetworkInfo['flagged']
  predefined: boolean
  wrappedAddr?: string
  blockGasLimit?: bigint
  oldNativeAssetSymbols?: string[]
  disableEstimateGas?: boolean
  force4337?: NetworkInfo['force4337']
  allowForce4337?: boolean
}

export type UserNetworkPreferencesForPredefinedNetworks = Pick<
  RelayerNetwork,
  'predefinedConfigVersion'
> &
  Partial<Pick<Network, 'rpcUrls' | 'selectedRpcUrl' | 'explorerUrl' | 'iconUrls'>>

export type UserNetworkPreferencesForCustomNetworks = UserNetworkPreferencesForPredefinedNetworks &
  Partial<Pick<Network, 'chainId' | 'name' | 'nativeAssetSymbol'>>

export type UserNetworkPreferences =
  | UserNetworkPreferencesForPredefinedNetworks
  | UserNetworkPreferencesForCustomNetworks

export interface AddNetworkRequestParams {
  name: Network['name']
  rpcUrls: Network['rpcUrls']
  selectedRpcUrl: Network['selectedRpcUrl']
  chainId: Network['chainId']
  nativeAssetSymbol: Network['nativeAssetSymbol']
  explorerUrl: Network['explorerUrl']
  iconUrls: Network['iconUrls']
}

export interface ChainlistNetwork {
  name: string
  chain: string
  icon: string
  rpc: string[]
  features: {
    name: string
  }[]
  faucets: string[]
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  infoURL: string
  shortName: string
  chainId: number
  networkId: number
  slip44: number
  ens: {
    registry: string
  }
  explorers: {
    name: string
    url: string
    standard: string
    icon?: string
  }[]
}

export type RelayerNetwork = {
  /**
   * Mechanism to merge incoming config with user storage. If versions match -
   * prioritize user changed values. If incoming config version is higher, override user config.
   */
  predefinedConfigVersion: number
  ambireId: string
  coingeckoPlatformId: string
  name: string
  icon: string
  explorerUrl: string
  rpcUrls: string[]
  selectedRpcUrl: string
  native: {
    symbol: string
    coingeckoId: string
    icon: string
    decimals: number
    wrapped: {
      address: string
      symbol: string
      coingeckoId: string
      icon: string
      decimals: number
    }
    oldNativeAssetSymbols?: string[]
  }
  isOptimistic: boolean
  disableEstimateGas: boolean
  feeOptions: {
    is1559: boolean
    elasticityMultiplier?: number
    baseFeeMaxChangeDenominator?: number
    feeIncrease?: number
    minBaseFee?: number
    minBaseFeeEqualToLastBlock?: boolean
  }
  smartAccounts: {
    hasRelayer: boolean
    erc4337: {
      enabled: boolean
      hasPaymaster: boolean
      hasBundlerSupport?: boolean
      bundlers?: { [bundler in BUNDLER]: string }
      defaultBundler?: BUNDLER
    }
    allowForce4337: boolean
  }
}

export type RelayerNetworkConfigResponse = { [chainId: string]: RelayerNetwork }
