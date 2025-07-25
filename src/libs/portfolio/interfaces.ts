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
    rewardsType: 'wallet-vesting' | 'wallet-rewards' | null
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

export interface ERC721Enumerable {
  isKnown: boolean
  enumerable: boolean
}
export interface ERC721Innumerable {
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

export type ExternalHintsAPIResponse = Hints & {
  networkId: string
  chainId: number
  accountAddr: string
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
   * In both cases, the hints are not user-specific so they must be learned
   * and saved in the extension.
   */
  hasHints: boolean
  /**
   * When true, prevents external API hints from overriding locally saved hints
   * and suppresses related UI errors. This flag is used when the hints database
   * is temporarily unavailable and the server falls back to static hints.
   */
  skipOverrideSavedHints?: boolean
  // Attached by the application error handling logic.
  // All other props, are provided by Velcro Discovery request.
  lastUpdate: number
  error?: string
}

export type StrippedExternalHintsAPIResponse = Pick<
  ExternalHintsAPIResponse,
  'erc20s' | 'erc721s' | 'lastUpdate' | 'skipOverrideSavedHints'
>

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
  toBeLearned: {
    erc20s: Hints['erc20s']
    erc721s: Hints['erc721s']
  }
  tokenErrors: { error: string; address: string }[]
  collections: CollectionResult[]
  hintsFromExternalAPI: StrippedExternalHintsAPIResponse | null
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

export interface GetOptions {
  baseCurrency: string
  blockTag: string | number
  simulation?: GetOptionsSimulation
  priceCache?: PriceCache
  priceRecency: number
  priceRecencyOnFailure?: number
  previousHintsFromExternalAPI?: StrippedExternalHintsAPIResponse | null
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
    [address: string]: 'custom' | 'hidden' | 'hidden-custom' | 'learn'
  }
  additionalErc20Hints?: Hints['erc20s']
  additionalErc721Hints?: Hints['erc721s']
  disableAutoDiscovery?: boolean
}

export interface PreviousHintsStorage {
  learnedTokens: { [chainId: string]: { [tokenAddress: string]: string | null } }
  learnedNfts: { [chainId: string]: { [nftAddress: string]: bigint[] } }
  fromExternalAPI: {
    [networkAndAccountKey: string]: GetOptions['previousHintsFromExternalAPI']
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
