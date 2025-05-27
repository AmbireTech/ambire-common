export interface CustomToken {
  address: string
  chainId: bigint
  standard: 'ERC20' | 'ERC721'
}

export interface TokenPreference {
  address: string
  chainId: bigint
  isHidden?: boolean
}

export type LegacyTokenPreference = TokenPreference & {
  symbol: string
  decimals: number
  standard: 'ERC20' | 'ERC721'
}
