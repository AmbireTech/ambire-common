import { JsonRpcProvider } from 'ethers'

import { Account } from './account'
import { Key } from './keystore'
import { Network } from './network'

export type AccountPreferences = {
  [key in Account['addr']]: {
    label: string
    // URL (https, ipfs or nft721://contractAddr/tokenId)
    pfp: string
  }
}

export type KeyPreferences = {
  addr: Key['addr']
  type: Key['type']
  label: string
}[]

export type NetworkPreference = {
  name?: string
  rpcUrls?: string[]
  selectedRpcUrl: string
  chainId?: bigint
  nativeAssetSymbol?: string
  explorerUrl?: string
  rpcNoStateOverride?: boolean
  hasDebugTraceCall?: boolean
  platformId?: string
  nativeAssetId?: string
  areContractsDeployed?: boolean
  hasSingleton?: boolean
}

export type CustomNetwork = {
  name: string
  rpcUrls: string[]
  selectedRpcUrl: string
  chainId: bigint
  nativeAssetSymbol: string
  explorerUrl: string
  iconUrls?: string[]
  isSAEnabled?: boolean
  areContractsDeployed?: boolean
  erc4337?: {
    enabled: boolean
    hasPaymaster: boolean
  }
  feeOptions?: {
    is1559: boolean
  }
  isOptimistic?: boolean
  rpcNoStateOverride?: boolean
  hasDebugTraceCall?: boolean
  platformId?: string
  nativeAssetId?: string
  flagged?: boolean
  hasSingleton?: boolean
}

export type NetworkPreferences = {
  [key in Network['id']]: NetworkPreference | CustomNetwork
}

export type RPCProvider = JsonRpcProvider & { isWorking?: boolean }

export type RPCProviders = { [networkId: Network['id']]: RPCProvider }
