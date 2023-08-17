import { Account } from '../../interfaces/account'
import { AccountOp } from '../accountOp/accountOp'

export interface Price {
  baseCurrency: string
  price: number
}

export interface Collectable {
  url: string
  id: bigint
}

export interface GetOptionsSimulation {
  accountOps: AccountOp[]
  account: Account
}

export interface TokenResult {
  address: string
  symbol: string
  amount: bigint
  amountPostSimulation?: bigint
  decimals: number
  priceIn: Price[]
}

export interface CollectionResult extends TokenResult {
  name: string
  collectables: Collectable[]
}

export type PriceCache = Map<string, [number, Price[]]>

interface ERC721Enumerable {
  isKnown: boolean
  enumerable: boolean
}
interface ERC721Innumerable {
  isKnown: boolean
  tokens: string[]
}

interface ERC721s {
  [name: string]: ERC721Enumerable | ERC721Innumerable
}

export interface Hints {
  networkId: string
  accountAddr: string
  erc20s: string[]
  erc721s: ERC721s
  prices: {
    [name: string]: Price
  }
  hasHints: boolean
  // Attached by the application error handling logic.
  // All other props, are provided by Velcro Discovery request.
  error?: string
}

export interface PortfolioGetResult {
  updateStarted: number
  discoveryTime: number
  oracleCallTime: number
  priceUpdateTime: number
  priceCache: PriceCache
  tokens: TokenResult[]
  tokenErrors: { error: string; address: string }[]
  collections: CollectionResult[]
  total: { [name: string]: bigint }
  hints: Hints
  hintsError?: string
}

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
