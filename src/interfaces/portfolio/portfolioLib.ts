import { Account, AccountOnchainState } from '../../interfaces/account'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { CollectionResult, Price, TokenResult } from './assets'
import { ExtendedErrorWithLevel } from './errors'
import { Hints } from './hints'

export interface LimitsOptions {
  erc20: number
  erc721: number
  erc721TokensInput: number
  erc721Tokens: number
}

export interface Limits {
  deploylessProxyMode: LimitsOptions
  deploylessStateOverrideMode: LimitsOptions
}

type SpecialHintType = 'custom' | 'hidden' | 'learn'

/**
 * Options for the portfolio lib's get method
 */
export interface GetOptions {
  baseCurrency: string
  /**
   * 'latest', 'pending' - self-explanatory
   * 'both' - fetches the asset info from the pending block and only the balances
   * from the latest block. Then merges the data together.
   * number - a specific block number to fetch the data from
   */
  blockTag: 'latest' | 'pending' | 'both' | number
  simulation?: GetOptionsSimulation
  priceCache?: PriceCache
  priceRecency: number
  priceRecencyOnFailure?: number
  fetchPinned: boolean
  /**
   * Hints for ERC20 tokens with a type
   * custom, hidden and pinned are fetched and returned
   * by the library regardless of their balance.
   * `learn` type hints are returned only if the token has a non-zero balance
   * and added to `toBeLearned`.
   * !!! If passed the portfolio lib will filter out tokens based on specific
   * conditions, such as balance and flags.
   */
  specialErc20Hints?: {
    [key in SpecialHintType]: string[]
  }
  /**
   * The same as `specialErc20Hints`. The only supported type at the moment
   * is `learn`.
   */
  specialErc721Hints?: {
    [key in SpecialHintType]: {
      [collectionAddr: string]: bigint[]
    }
  }
  additionalErc20Hints?: Hints['erc20s']
  additionalErc721Hints?: Hints['erc721s']
  disableAutoDiscovery?: boolean
}

/**
 * The result of the portfolio lib's get method
 */
export interface PortfolioLibGetResult {
  updateStarted: number
  discoveryTime: number
  oracleCallTime: number
  priceUpdateTime: number
  priceCache: PriceCache
  tokens: TokenResult[]
  feeTokens: TokenResult[]
  /**
   * Assets the user owns that need to be learned by the controller.
   * Basically all assets with balance, excluding custom and preferences
   */
  toBeLearned: {
    erc20s: Hints['erc20s']
    erc721s: Hints['erc721s']
  }
  tokenErrors: { error: string; address: string }[]
  collections: CollectionResult[]
  errors: ExtendedErrorWithLevel[]
  blockNumber: number
  beforeNonce: bigint
  afterNonce: bigint
}

export interface GetOptionsSimulation {
  accountOps: AccountOp[]
  account: Account
  state: AccountOnchainState
}

/**
 * Cache for prices, used to avoid redundant price fetches
 * Map<tokenAddress, [timestamp, prices]>
 */
export type PriceCache = Map<string, [number, Price[]]>

export type MetaData = { blockNumber?: number; beforeNonce?: bigint; afterNonce?: bigint }
