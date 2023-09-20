import { NetworkId } from 'interfaces/networkDescriptor'

import { Account } from '../../interfaces/account'
import { AccountOp } from '../accountOp/accountOp'

export interface Price {
  baseCurrency: string
  price: number
}

export interface Collectible {
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
  networkId: NetworkId
  amountPostSimulation?: bigint
  decimals: number
  priceIn: Price[]
}

export interface CollectionResult extends TokenResult {
  name: string
  collectibles: Collectible[]
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

type AccountState = {
  // network id
  [key: string]:
    | {
        isReady: boolean
        isLoading: boolean
        criticalError?: Error
        errors?: Error[]
        result?: PortfolioGetResult
        // We store the previously simulated AccountOps only for the pending state.
        // Prior to triggering a pending state update, we compare the newly passed AccountOp[] (updateSelectedAccount) with the cached version.
        // If there are no differences, the update is canceled unless the `forceUpdate` flag is set.
        accountOps?: AccountOp[]
      }
    | undefined
}
// account => network => PortfolioGetResult, extra fields
export type PortfolioControllerState = {
  // account id
  [key: string]: AccountState
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
