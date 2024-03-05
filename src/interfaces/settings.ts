import { JsonRpcProvider } from 'ethers'

import { Account } from './account'
import { Key } from './keystore'
import { NetworkDescriptor } from './networkDescriptor'

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
  rpcUrl?: string
  chainId?: bigint
  nativeAssetSymbol?: string
  explorerUrl?: string
}

export type CustomNetwork = {
  name: string
  rpcUrl: string
  chainId: bigint
  nativeAssetSymbol: string
  explorerUrl: string
}

export type NetworkPreferences = {
  [key in NetworkDescriptor['id']]: NetworkPreference | CustomNetwork
}

export type RPCProvider = JsonRpcProvider & { isWorking?: boolean }

export type RPCProviders = { [networkId: NetworkDescriptor['id']]: RPCProvider }
