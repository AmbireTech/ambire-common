import {
  AccountState,
  CollectionResult as CollectionResultInterface,
  NetworkSimulatedAccountOp,
  TokenAmount as TokenAmountInterface,
  TokenResult as TokenResultInterface
} from '../libs/portfolio/interfaces'

export interface SelectedAccountPortfolio {
  tokens: TokenResultInterface[]
  collections: CollectionResultInterface[]
  totalBalance: number
  isAllReady: boolean
  networkSimulatedAccountOp: NetworkSimulatedAccountOp
  tokenAmounts: TokenAmountInterface[]
  latest: AccountState
  pending: AccountState
}
