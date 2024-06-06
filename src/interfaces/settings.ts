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

export type RPCProvider = JsonRpcProvider & { isWorking?: boolean }

export type RPCProviders = { [networkId: Network['id']]: RPCProvider }
