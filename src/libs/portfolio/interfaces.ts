import { Account, AccountId, AccountOnchainState } from '../../interfaces/account'
import { Price } from '../../interfaces/assets'
import { AccountOp } from '../accountOp/accountOp'
import {
  AssetType,
  NetworkState as DefiNetworkState,
  PositionsByProvider
} from '../defiPositions/types'

// @TODO: Move most of these interfaces to src/interfaces and
// figure out how to restructure portfolio/defiPositions types

export interface GetOptionsSimulation {
  accountOps: AccountOp[]
  account: Account
  state: AccountOnchainState
}
export type TokenError = string | '0x'

export type AccountAssetsState = { [chainId: string]: boolean }
export type SuspectedType = 'suspected' | null

export type TokenResult = {
  symbol: string
  name: string
  decimals: number
  address: string
  chainId: bigint
  amount: bigint
  latestAmount?: bigint
  pendingAmount?: bigint
  simulationAmount?: bigint
  amountPostSimulation?: bigint
  priceIn: Price[]
  flags: {
    onGasTank: boolean
    rewardsType: 'wallet-vesting' | 'wallet-rewards' | 'wallet-projected-rewards' | null
    defiTokenType?: AssetType
    defiPositionId?: string
    canTopUpGasTank: boolean
    isFeeToken: boolean
    isHidden?: boolean
    isCustom?: boolean
    suspectedType?: SuspectedType
  }
}

export type GasTankTokenResult = TokenResult & {
  availableAmount: bigint
}

export interface CollectionResult extends TokenResult {
  name: string
  collectibles: bigint[]
  postSimulation?: {
    sending?: bigint[]
    receiving?: bigint[]
  }
}

/**
 * Cache for prices, used to avoid redundant price fetches
 * Map<tokenAddress, [timestamp, prices]>
 */
export type PriceCache = Map<string, [number, Price[]]>

export type MetaData = { blockNumber?: number; beforeNonce?: bigint; afterNonce?: bigint }

/**
 * ERC-721 hints, returned by the Velcro API
 * Their structure is different and more complex than the structure
 * we use in the extension
 */
export interface VelcroERC721Hints {
  [collectionAddress: string]:
    | {
        isKnown: boolean
        enumerable: boolean
      }
    | {
        isKnown: boolean
        tokens: string[]
      }
}

/**
 * ERC-721 hints, used by the portfolio
 * [collectionAddress]: the ids of the collectibles in the collection.
 */
export interface ERC721s {
  [collectionAddress: string]: bigint[]
}

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
  erc20s: string[]
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

/**
 * The raw response, returned by the Velcro API.
 * Currently only called by the portfolio lib to fetch hints only.
 */
export type ExternalHintsAPIResponse = {
  erc20s: Hints['erc20s']
  erc721s: VelcroERC721Hints
} & (Required<Hints['externalApi']> & {
  error?: string
})

/**
 * The raw response, returned by Velcro for portfolio discovery.
 * It contains hints and defi positions. Used by the controller.
 */
export type ExternalPortfolioDiscoveryResponse = {
  networkId: string
  chainId: number
  accountAddr: string
  hints: ExternalHintsAPIResponse
  prices: {
    [addr: string]: Price
  }
  defi: {
    positions: Omit<PositionsByProvider, 'source'>[]
    updatedAt: number
    error?: string
  }
}

export type FormattedPortfolioDiscoveryResponse = {
  data: {
    hints: FormattedExternalHintsAPIResponse | null
    defi: {
      positions: PositionsByProvider[]
    } & Pick<ExternalPortfolioDiscoveryResponse['defi'], 'updatedAt' | 'error'>
  } | null
  errors: ExtendedErrorWithLevel[]
}

/**
 * A stripped version of `ExternalHintsAPIResponse`. Also, ERC-721 hints
 * are formatted to be in the structure, expected by the extension.
 */
export type FormattedExternalHintsAPIResponse = {
  erc20s: Hints['erc20s']
  erc721s: Hints['erc721s']
  lastUpdate: ExternalHintsAPIResponse['lastUpdate']
  hasHints: ExternalHintsAPIResponse['hasHints']
}

export interface ExtendedError extends Error {
  simulationErrorMsg?: string
}

export type ExtendedErrorWithLevel = ExtendedError & {
  level: 'critical' | 'warning' | 'silent'
}

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

export interface Total {
  [currency: string]: number
}

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

export type AddrVestingData = {
  addr: string
  rate: string
  start: string
  end: string
}

type CommonResultProps = Pick<PortfolioLibGetResult, 'tokens' | 'updateStarted'> & {
  lastSuccessfulUpdate: number
  total: Total
}

export type PortfolioNetworkResult = CommonResultProps &
  Pick<
    PortfolioLibGetResult,
    'collections' | 'tokenErrors' | 'blockNumber' | 'priceCache' | 'toBeLearned' | 'feeTokens'
  > & {
    defiPositions: DefiNetworkState
    lastExternalApiUpdateData?: {
      lastUpdate: number
      hasHints: boolean
    } | null
  }

export type PortfolioRewardsResult = CommonResultProps &
  Pick<PortfolioNetworkResult, 'tokens' | 'total' | 'updateStarted' | 'lastSuccessfulUpdate'> & {
    claimableRewardsData?: ClaimableRewardsData
    addrVestingData?: AddrVestingData
    xWalletClaimableBalance?: Pick<TokenResult, 'decimals' | 'address' | 'priceIn' | 'symbol'> & {
      amount: string
      chainId: number
    }
  }

export type PortfolioGasTankResult = CommonResultProps & {
  gasTankTokens: GasTankTokenResult[]
}

export type PortfolioProjectedRewardsResult = {
  weeksWithData: {
    week: number
    balance: number
    liquidityUsd: number
    stkWalletUsd: number
  }[]
  swapVolume: number
  poolSize: number
  rank: number
  walletPrice: number
  pointsOfOtherUsers: number
  numberOfWeeksSinceStartOfSeason: number
  multipliers: { type: string; activated: boolean }[]
  weeklyTx: number
  frozenRewardSeason1: number
  governanceVotes: {
    weight: number
    walletPrice: number
  }[]
  supportedChainIds: number[]
}

export type ProjectedRewardsStats = {
  // Scores
  balanceScore: number
  stkWALLETScore: number
  liquidityScore: number
  swapVolumeScore: number
  governanceScore: number
  // Average
  averageBalance: number
  averageLiquidity: number
  averageStkWalletBalance: number
  // Other
  governanceWeight: number
  swapVolume: number
  poolSize: number
  rank: number
  totalScore: number
  multiplierCount: number
  multiplier: number
  estimatedRewards: number
  estimatedRewardsUSD: number
  multipliers: PortfolioProjectedRewardsResult['multipliers']
}

export type PortfolioKeyResult =
  | PortfolioRewardsResult
  | PortfolioGasTankResult
  | PortfolioProjectedRewardsResult
  | PortfolioNetworkResult

export type NetworkState<T = PortfolioKeyResult> = {
  isReady: boolean
  isLoading: boolean
  criticalError?: ExtendedError
  errors: ExtendedErrorWithLevel[]
  result?: T
  // We store the previously simulated AccountOps only for the pending state.
  // Prior to triggering a pending state update, we compare the newly passed AccountOp[] (updateSelectedAccount) with the cached version.
  // If there are no differences, the update is canceled unless the `forceUpdate` flag is set.
  accountOps?: AccountOp[]
}

export type AccountState = {
  rewards?: NetworkState<PortfolioRewardsResult>
  gasTank?: NetworkState<PortfolioGasTankResult>
  projectedRewards?: NetworkState<PortfolioProjectedRewardsResult>
} & {
  [chainId: string]: NetworkState<PortfolioNetworkResult> | undefined
}

export type PortfolioControllerState = {
  // accountId:chainId:NetworkState
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
  chainId: bigint
  address: string
  onGasTank: boolean
  accountId?: AccountId
}[]

export type TemporaryTokens = {
  [chainId: string]: {
    isLoading: boolean
    errors: { error: string; address: string }[]
    result: { tokens: PortfolioLibGetResult['tokens'] }
  }
}

type SpecialHintType = 'custom' | 'hidden' | 'learn'

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

export interface NetworkSimulatedAccountOp {
  [chainId: string]: AccountOp
}

export type PendingAmounts = {
  isPending: boolean
  pendingBalance: bigint
  pendingToBeSigned?: bigint
  pendingToBeConfirmed?: bigint
}

export type FormattedPendingAmounts = Omit<PendingAmounts, 'pendingBalance'> & {
  pendingBalance: string
  pendingBalanceFormatted: string
  pendingBalanceUSDFormatted?: string
  pendingToBeSignedFormatted?: string
  pendingToBeConfirmedFormatted?: string
}

export type KnownTokenInfo = {
  name?: string
  address?: string
  token?: { symbol?: string; decimals?: number }
  isSC?: boolean
  chainIds?: number[]
}

export type TokenValidationResult = {
  isValid: boolean
  standard: string
  error: { message: string | null; type: 'network' | 'validation' | null }
}
