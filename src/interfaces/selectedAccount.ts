import {
  CollectionResult as CollectionResultInterface,
  NetworkSimulatedAccountOp,
  NetworkState,
  TokenResult as TokenResultInterface
} from '../libs/portfolio/interfaces'
import { AccountId } from './account'

/** A stripped version of the portfolio state that will be used in the UI */
export type SelectedAccountPortfolioState = {
  [networkId: string]:
    | (Omit<NetworkState, 'result'> & {
        result?: Omit<
          NonNullable<NetworkState['result']>,
          'tokens' | 'collections' | 'tokenErrors' | 'hintsFromExternalAPI' | 'priceCache'
        >
      })
    | undefined
}

export type SelectedAccountPortfolioTokenResult = TokenResultInterface & {
  latestAmount?: bigint
  pendingAmount?: bigint
}

export interface SelectedAccountPortfolio {
  tokens: SelectedAccountPortfolioTokenResult[]
  collections: CollectionResultInterface[]
  totalBalance: number
  /** Either all portfolio networks have loaded or a timeout has been reached and there are tokens.
   * @example - If the user has 3 networks and 2 of them have loaded, but the third has not and a timeout has been reached
   * the value of isReadyToVisualize will be true.
   */
  isReadyToVisualize: boolean
  /** True after all networks have loaded */
  isAllReady: boolean
  networkSimulatedAccountOp: NetworkSimulatedAccountOp
  latest: SelectedAccountPortfolioState
  pending: SelectedAccountPortfolioState
}

// As of version 4.53.0, cashback status information has been introduced.
// Previously, each account stored a separate cashback status object with multiple timestamps.
// Now, cashback statuses are represented as a single normalized value for simplifying.
// This type represents the old structure before migration.
export type LegacyCashbackStatus = {
  firstCashbackReceivedAt: number | null
  firstCashbackSeenAt: number | null
  cashbackWasZeroAt: number | null
}

export type CashbackStatus = 'no-cashback' | 'unseen-cashback' | 'cashback-modal' | 'seen-cashback'

export type CashbackStatusByAccount = {
  [key: AccountId]: CashbackStatus
}
