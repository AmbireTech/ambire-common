import { Account, AccountId } from '../../interfaces/account'
import { NetworkId } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { CustomToken } from './customToken'

export interface Price {
  baseCurrency: string
  price: number
}

export interface GetOptionsSimulation {
  accountOps: AccountOp[]
  account: Account
}

export type TokenResult = Omit<CustomToken, 'standard'> & {
  amount: bigint
  simulationAmount?: bigint
  amountPostSimulation?: bigint
  priceIn: Price[]
  flags: {
    onGasTank: boolean
    rewardsType: 'wallet-vesting' | 'wallet-rewards' | null
    canTopUpGasTank: boolean
    isFeeToken: boolean
    safetyLevel?: 'trusted' | 'unknown' | 'spoof'
  }
}

export interface CollectionResult extends TokenResult {
  name: string
  collectibles: bigint[]
  postSimulation?: {
    sending?: bigint[]
    receiving?: bigint[]
  }
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
  erc20s: string[]
  erc721s: ERC721s
}

export interface ExternalHintsAPIResponse extends Hints {
  networkId: string
  accountAddr: string
  prices: {
    [name: string]: Price
  }
  hasHints: boolean
  // Attached by the application error handling logic.
  // All other props, are provided by Velcro Discovery request.
  error?: string
}

export interface ExtendedError extends Error {
  simulationErrorMsg?: string
}

export interface PortfolioLibGetResult {
  updateStarted: number
  discoveryTime: number
  oracleCallTime: number
  priceUpdateTime: number
  priceCache: PriceCache
  tokens: TokenResult[]
  tokenErrors: { error: string; address: string }[]
  collections: CollectionResult[]
  hintsFromExternalAPI: Hints | null
  errors: ExtendedError[]
  blockNumber: number
}

interface Total {
  [currency: string]: number
}

type AdditionalPortfolioProperties = 'updateStarted' | 'tokens'

export type ClaimableRewardsData = {
  addr: string
  fromBalanceClaimable: number
  fromADXClaimable: number
  totalClaimable: string
  leaf: string
  proof: string[]
  root: string
  signedRoot: string
}

// Create the final type with some properties optional
export type AdditionalPortfolioNetworkResult = Partial<PortfolioLibGetResult> &
  Pick<PortfolioLibGetResult, AdditionalPortfolioProperties> & {
    total: Total
    claimableRewardsData?: ClaimableRewardsData
  }

type PortfolioNetworkResult = Required<AdditionalPortfolioNetworkResult>

export type NetworkState = {
  isReady: boolean
  isLoading: boolean
  criticalError?: ExtendedError
  errors: ExtendedError[]
  result?: PortfolioNetworkResult | AdditionalPortfolioNetworkResult
  // We store the previously simulated AccountOps only for the pending state.
  // Prior to triggering a pending state update, we compare the newly passed AccountOp[] (updateSelectedAccount) with the cached version.
  // If there are no differences, the update is canceled unless the `forceUpdate` flag is set.
  accountOps?: AccountOp[]
}

export type AccountState = {
  [networkId: string]: NetworkState | undefined
}

export type PortfolioControllerState = {
  // accountId:networkId:NetworkState
  [accountId: string]: AccountState
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
  networkId: NetworkId
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
  learnedTokens: { [network in NetworkId]: { [tokenAddress: string]: string | null } }
  fromExternalAPI: { [networkAndAccountKey: string]: GetOptions['previousHints'] }
}
