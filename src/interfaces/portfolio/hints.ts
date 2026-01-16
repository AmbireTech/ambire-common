import { AccountId } from '../../interfaces/account'
import { Price } from './assets'

export type PinnedTokens = {
  chainId: bigint
  address: string
  onGasTank: boolean
  accountId?: AccountId
}[]

/**
 * Hints, divided by standard -> chainId
 * These hints are temporary, not stored in storage and used
 * for the simulation and humanizer. They likely don't have balance
 */
export interface ToBeLearnedAssets {
  erc20s: {
    [chainId: string]: string[]
  }
  erc721s: {
    [chainId: string]: ERC721s
  }
}

/**
 * Hints, divided by standard -> chainId:account
 * ERC-20s: Tokens that the user has had a balance of at some point. Each token holds
 * a timestamp, updated after every portfolio update if the account has balance of the token.
 * ERC-721s: Nfts learned from velcro and debugTraceCall. The account doesn't necessary
 * have to own them.
 */
export interface LearnedAssets {
  /**
   * [chainId:account]: Hints
   */
  erc20s: {
    [chainIdAndAccount: string]: {
      /**
       * [tokenAddress]: A timestamp of the last time the token was seen with a balance > 0
       */
      [tokenAddress: string]: number
    }
  }
  /**
   * [chainId:account]: Hints
   */
  erc721s: {
    [chainIdAndAccount: string]: {
      /**
       * There are two types of keys:
       * [0x026224A2940bFE258D0dbE947919B62fE321F042:2647]: A timestamp of the last time the collectible was owned by the user
       * [0x35bAc15f98Fa2F496FCb84e269d8d0a408442272:enumerable]: A timestamp of the last time the collection was owned by the user(enumerable)
       */
      [collectionAddressAndId: string]: number
    }
  }
}

/**
 * @deprecated - see `LearnedAssets`
 */
export interface PreviousHintsStorage {
  learnedTokens: { [chainId: string]: { [tokenAddress: string]: string | null } }
  learnedNfts: { [chainId: string]: { [nftAddress: string]: bigint[] } }
  fromExternalAPI: {
    [networkAndAccountKey: string]: {
      lastUpdate: number
      erc20s: Hints['erc20s']
      erc721s: ERC721s
      hasHints: boolean
    }
  }
}

/**
 * ERC-721 hints, used by the portfolio
 * [collectionAddress]: the ids of the collectibles in the collection.
 */
export interface ERC721s {
  [collectionAddress: string]: bigint[]
}

export type ERC20s = string[]

/**
 * The portfolio fetches tokens using deployless. We provide
 * "hints" to deployless, so it knows where to look for assets. Hints are
 * assets of different standards that the user is likely to have. They come from
 * different sources, like:
 * - Velcro - our external API for hints
 * - Custom tokens (ERC-20 only atm)
 * - Token preferences (ERC-20 only atm)
 * - Learned assets - see `LearnedAssets` for more info
 */
export interface Hints {
  erc20s: ERC20s
  erc721s: ERC721s
  /**
   * Metadata and prices from the Velcro API call
   */
  externalApi?: {
    /**
     * When hasHints is false and the list is generated from a top X list,
     * the prices are coming together with the hints as the response contains
     * prices for all tokens in the hints. In this case the extension should
     * not make separate requests for prices.
     */
    prices: {
      [addr: string]: Price
    }
    /**
     * When true, either the account is empty and static hints are returned,
     * or the hints are coming from a top X list of tokens, sorted by market cap.
     * Used to determine how often to refetch the hints.
     */
    hasHints: boolean
    /**
     * Attached by the application after the request response or, if there is an
     * error or the request is skipped, we get it from the last call.
     */
    lastUpdate: number
  }
}
