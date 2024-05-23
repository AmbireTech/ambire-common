import { Account, AccountId } from '../../interfaces/account'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { AccountOp } from '../accountOp/accountOp'
import { CustomToken } from './customToken'

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

export interface TokenResult extends Partial<CustomToken> {
  address: string
  symbol: string
  amount: bigint
  networkId: NetworkId
  amountPostSimulation?: bigint
  decimals: number
  priceIn: Price[]
  flags: {
    onGasTank: boolean
    rewardsType: string | null
    canTopUpGasTank: boolean
    isFeeToken: boolean
  }
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

export interface ERC721s {
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

interface ExtendedError extends Error {
  simulationErrorMsg?: string
}

export type NetworkState = {
  isReady: boolean
  isLoading: boolean
  criticalError?: ExtendedError
  errors: ExtendedError[]
  result?: PortfolioGetResult
  // We store the previously simulated AccountOps only for the pending state.
  // Prior to triggering a pending state update, we compare the newly passed AccountOp[] (updateSelectedAccount) with the cached version.
  // If there are no differences, the update is canceled unless the `forceUpdate` flag is set.
  accountOps?: AccountOp[]
}

export type AccountState = {
  // network id
  [key: string]: NetworkState | undefined
}

export type AdditionalAccountState = {
  // network id
  [key: string]:
    | {
        isReady: boolean
        isLoading: boolean
        criticalError?: Error
        errors: Error[]
        result?: AdditionalPortfolioGetResult
      }
    | undefined
}

// account => network => PortfolioGetResult, extra fields
export type PortfolioControllerState = {
  // account id
  [key: string]: AccountState
}

export interface AdditionalPortfolioGetResult {
  updateStarted: number
  tokens: TokenResult[]
  total: { [name: string]: number }
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
  total: { [name: string]: number }
  hints: Hints
  errors: ExtendedError[]
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

export type PinnedTokens = {
  networkId: NetworkDescriptor['id']
  address: string
  onGasTank: boolean
  accountId?: AccountId
}[]

export interface GetOptions {
  baseCurrency: string
  blockTag: string | number
  simulation?: GetOptionsSimulation
  priceCache?: PriceCache
  priceRecency: number
  previousHints?: {
    erc20s: Hints['erc20s']
    erc721s: Hints['erc721s']
  }
  isEOA: boolean
  fetchPinned: boolean
  tokenPreferences: CustomToken[]
  additionalHints?: Hints['erc20s']
  disableAutoDiscovery?: boolean
}

export interface PreviousHintsStorage {
  learnedTokens: { [key in NetworkId]: { [key: string]: string | null } }
  fromExternalAPI: { [key: string]: GetOptions['previousHints'] }
}
