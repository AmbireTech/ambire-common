// TODO: fill in the missing types

import { UseToastsReturnType } from '../toasts/types'

export type Token = {
  account: string
  address: string
  balance: string
  balanceRaw: string
  decimals: number
  name: string
  network: string
  symbol: string
  tokenImageUrl: string
}

export type UsePortfolioReturnTypes = {
  balance: any
  otherBalances: any
  tokens: Token[]
  protocols: any
  extraTokens: Token[]
  hiddenTokens: Token[]
  collectibles: any
  requestOtherProtocolsRefresh: () => Promise<any>
  onAddExtraToken: (extraToken: Token) => void
  onRemoveExtraToken: (address: Token['address']) => void
  onAddHiddenToken: (hiddenToken: Token) => void
  onRemoveHiddenToken: (address: Token['address']) => void
  balancesByNetworksLoading: any
  isCurrNetworkBalanceLoading: boolean
  areAllNetworksBalancesLoading: () => boolean
  otherProtocolsByNetworksLoading: any
  isCurrNetworkProtocolsLoading: boolean
  loadBalance: any
  loadProtocols: any
}

export type UsePortfolioProps = {
  currentNetwork: any
  account: any
  useStorage: any
  isVisible: boolean
  useToasts: () => UseToastsReturnType
  getBalances: any
}
