import { NetworkId } from '../../interfaces/network'

export interface CustomToken {
  address: string
  networkId: NetworkId
  standard: 'ERC20' | 'ERC721'
}

export interface TokenPreference {
  address: string
  networkId: NetworkId
  isHidden?: boolean
}

export type LegacyTokenPreference = TokenPreference & {
  symbol: string
  decimals: number
  standard: 'ERC20' | 'ERC721'
}
