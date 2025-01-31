import {
  CollectionResult as CollectionResultInterface,
  NetworkSimulatedAccountOp,
  NetworkState,
  TokenResult as TokenResultInterface
} from '../libs/portfolio/interfaces'

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
  isReadyToVisualize: boolean
  isAllReady: boolean
  networkSimulatedAccountOp: NetworkSimulatedAccountOp
  latest: SelectedAccountPortfolioState
  pending: SelectedAccountPortfolioState
}
