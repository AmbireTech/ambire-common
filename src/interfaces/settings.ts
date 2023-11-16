import { Account } from './account'
import { Key } from './keystore'

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
