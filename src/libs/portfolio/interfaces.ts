import { AccountOp } from '../accountOp/accountOp'
import { Account } from '../../interfaces/account'

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
  // only applicable for NFTs
  name?: string
  collectables?: Collectable[]
}

export type PriceCache = Map<string, [number, Price[]]>

export interface PortfolioGetResult {
  updateStarted: number
  discoveryTime: number
  oracleCallTime: number
  priceUpdateTime: number
  priceCache: PriceCache
  tokens: TokenResult[]
  tokenErrors: { error: string; address: string }[]
  collections: TokenResult[]
  total: { [name: string]: bigint }
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
