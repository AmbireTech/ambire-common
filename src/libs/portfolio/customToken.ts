export interface CustomToken {
  address: string
  chainId: bigint
  standard: 'ERC20' | 'ERC721'
  /**
   * Set for ERC-721 collectibles, which are added one by one, as the account has
   * to own what it adds. Collectibles added before this was recorded have none,
   * which means the whole collection.
   */
  tokenId?: bigint
}

export interface TokenPreference {
  address: string
  chainId: bigint
  isHidden?: boolean
  /** Preferences stored before NFT hiding have none, which means ERC-20 */
  standard?: CustomToken['standard']
  /**
   * Set for ERC-721 collectibles, which are hidden one by one. A preference
   * without one hides the whole collection.
   */
  tokenId?: bigint
}

export type LegacyTokenPreference = TokenPreference & {
  symbol: string
  decimals: number
  standard: 'ERC20' | 'ERC721'
}

/** Identifies a token, a collection or a single collectible of a collection */
export const getAssetPreferenceId = ({
  address,
  chainId,
  tokenId
}: {
  address: string
  chainId: bigint
  tokenId?: bigint
}) => `${chainId}-${address.toLowerCase()}${typeof tokenId === 'bigint' ? `-${tokenId}` : ''}`
