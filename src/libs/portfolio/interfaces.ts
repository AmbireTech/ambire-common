import { Account, AccountId, AccountOnchainState } from '../../interfaces/account'
import { Price } from '../../interfaces/assets'
import { AccountOp } from '../accountOp/accountOp'
import { AssetType } from '../defiPositions/types'

export interface GetOptionsSimulation {
  accountOps: AccountOp[]
  account: Account
  state: AccountOnchainState
}
export type TokenError = string | '0x'

export type AccountAssetsState = { [chainId: string]: boolean }

export type TokenResult = {
  symbol: string
  name: string
  decimals: number
  address: string
  chainId: bigint
  amount: bigint
  simulationAmount?: bigint
  amountPostSimulation?: bigint
  priceIn: Price[]
  flags: {
    onGasTank: boolean
    rewardsType: 'wallet-vesting' | 'wallet-rewards' | 'wallet-projected-rewards' | null
    defiTokenType?: AssetType
    canTopUpGasTank: boolean
    isFeeToken: boolean
    isHidden?: boolean
    isCustom?: boolean
  }
}

export type GasTankTokenResult = TokenResult & {
  availableAmount: bigint
  cashback: bigint
  saved: bigint
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
 * The raw response, returned by the Velcro API
 */
export type ExternalHintsAPIResponse = {
  erc20s: Hints['erc20s']
  erc721s: VelcroERC721Hints
} & (Required<Hints['externalApi']> & {
  networkId: string
  chainId: number
  accountAddr: string
  error?: string
})

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

type ExtendedErrorWithLevel = ExtendedError & {
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
  /**
   * Metadata from the last external api hints call. It comes from the API
   * if the request is successful and not cached, or from cache otherwise.
   */
  lastExternalApiUpdateData: {
    lastUpdate: number
    hasHints: boolean
  } | null
  errors: ExtendedErrorWithLevel[]
  blockNumber: number
  beforeNonce: bigint
  afterNonce: bigint
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

export type AddrVestingData = {
  addr: string
  rate: string
  start: string
  end: string
}

// Create the final type with some properties optional
export type AdditionalPortfolioNetworkResult = Partial<PortfolioLibGetResult> &
  Pick<PortfolioLibGetResult, AdditionalPortfolioProperties> & {
    lastSuccessfulUpdate: number
    total: Total
    claimableRewardsData?: ClaimableRewardsData
    addrVestingData?: AddrVestingData
  }

type PortfolioNetworkResult = Required<AdditionalPortfolioNetworkResult>

export type PortfolioGasTankResult = AdditionalPortfolioNetworkResult & {
  gasTankTokens: GasTankTokenResult[]
}

export type NetworkState = {
  isReady: boolean
  isLoading: boolean
  criticalError?: ExtendedError
  errors: ExtendedErrorWithLevel[]
  result?: PortfolioNetworkResult | AdditionalPortfolioNetworkResult | PortfolioGasTankResult
  // We store the previously simulated AccountOps only for the pending state.
  // Prior to triggering a pending state update, we compare the newly passed AccountOp[] (updateSelectedAccount) with the cached version.
  // If there are no differences, the update is canceled unless the `forceUpdate` flag is set.
  accountOps?: AccountOp[]
}

export type AccountState = {
  [chainId: string]: NetworkState | undefined
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
  blockTag: string | number
  simulation?: GetOptionsSimulation
  priceCache?: PriceCache
  priceRecency: number
  priceRecencyOnFailure?: number
  lastExternalApiUpdateData?: {
    lastUpdate: number
    hasHints: boolean
  } | null
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
