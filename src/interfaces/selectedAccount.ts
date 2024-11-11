import {
  AccountState,
  CollectionResult as CollectionResultInterface,
  NetworkNonces as NetworkNoncesInterface,
  TokenAmount as TokenAmountInterface,
  TokenResult as TokenResultInterface
} from '../libs/portfolio/interfaces'

export interface SelectedAccountPortfolio {
  tokens: TokenResultInterface[]
  collections: CollectionResultInterface[]
  totalBalance: number
  isAllReady: boolean
  simulationNonces: NetworkNoncesInterface
  tokenAmounts: TokenAmountInterface[]
  latestStateByNetworks: AccountState
  pendingStateByNetworks: AccountState
}
