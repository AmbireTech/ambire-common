import {
  CollectionResult as CollectionResultInterface,
  NetworkSimulatedAccountOp,
  NetworkState,
  TokenResult as TokenResultInterface
} from '../libs/portfolio/interfaces'
import { ControllerInterface } from './controller'

export type ISelectedAccountController = ControllerInterface<
  InstanceType<
    typeof import('../controllers/selectedAccount/selectedAccount').SelectedAccountController
  >
>

/** A stripped version of the portfolio state that will be used in the UI */
export type SelectedAccountPortfolioState = {
  [chainId: string]:
    | (Omit<NetworkState, 'result'> & {
        result?: Omit<
          NonNullable<NetworkState['result']>,
          'tokens' | 'collections' | 'tokenErrors' | 'hintsFromExternalAPI' | 'priceCache' | 'total'
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
  /**
   * Either all portfolio networks have loaded or a timeout has been reached and there are tokens.
   * @example - If the user has 3 networks and 2 of them have loaded, but the third has not and a timeout has been reached
   * the value of isReadyToVisualize will be true.
   */
  isReadyToVisualize: boolean
  /**
   * True after all networks have initially loaded. Becomes false when a manual reload is triggered.
   * May be true even if a network is loading (e.g. during an interval update).
   */
  isAllReady: boolean
  /** True if the portfolio is not fully ready, but a timeout has been reached and there are tokens to show. */
  shouldShowPartialResult: boolean
  /**
   * True if `isAllReady` is true, the portfolio hasn't reloaded for a while, and a reload is in progress.
   */
  isReloading: boolean

  balancePerNetwork: {
    [chainId: string]: number
  }
  networkSimulatedAccountOp: NetworkSimulatedAccountOp
  portfolioState: SelectedAccountPortfolioState
}
