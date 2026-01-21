import { AccountId } from 'interfaces/account'
import { AccountOp } from 'libs/accountOp/accountOp'

import { ControllerInterface } from '../../interfaces/controller'
import { GasTankTokenResult, TokenResult } from './assets'
import { PositionsByProvider, ProviderName } from './defiLib'
import { ExtendedError, ExtendedErrorWithLevel, ProviderError } from './errors'
import { ERC721s, Hints } from './hints'
import { PortfolioLibGetResult } from './portfolioLib'

export type IPortfolioController = ControllerInterface<
  InstanceType<typeof import('../../controllers/portfolio/portfolio').PortfolioController>
>

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
  total: Total
}

export type PortfolioNetworkResult = CommonResultProps &
  Pick<
    PortfolioLibGetResult,
    | 'collections'
    | 'tokenErrors'
    | 'blockNumber'
    | 'priceCache'
    | 'toBeLearned'
    | 'feeTokens'
    | 'priceUpdateTime'
    | 'oracleCallTime'
    | 'discoveryTime'
  > & {
    defiPositions: DefiNetworkState
    lastExternalApiUpdateData?: {
      lastUpdate: number
      hasHints: boolean
    } | null
  }

export type PortfolioRewardsResult = CommonResultProps &
  Pick<PortfolioNetworkResult, 'tokens' | 'total' | 'updateStarted'> & {
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
  lastSuccessfulUpdate?: number
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

export type TemporaryTokens = {
  [chainId: string]: {
    isLoading: boolean
    errors: { error: string; address: string }[]
    result: { tokens: TokenResult[] }
  }
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

export type AccountAssetsState = { [chainId: string]: boolean }

export interface Total {
  [currency: string]: number
}

export interface NetworkSimulatedAccountOp {
  [chainId: string]: AccountOp
}

export interface DefiNetworkState {
  positionsByProvider: PositionsByProvider[]
  /**
   * Timestamp of the last successful update
   * (no custom provider errors and a successful external api call)
   *
   * Used to determine whether to update the positions and display
   * errors on the UI
   */
  lastSuccessfulUpdate?: number
  /**
   * Timestamp of the last force external api call
   * Used to determine if we should bypass the cache on next update
   */
  lastForceApiUpdate?: number
  error?: string | null
  providerErrors?: ProviderError[]
  nonceId?: string
}

export type NetworksWithPositions = {
  [chainId: string]: ProviderName[]
}

/**
 * The count of defi positions on disabled networks for each account.
 */
export type PositionCountOnDisabledNetworks = {
  [accountId: string]: {
    [chainId: string]: number
  }
}

export type NetworksWithPositionsByAccounts = {
  [accountId: string]: NetworksWithPositions
}
