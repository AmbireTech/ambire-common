// TODO: fill in the missing types

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
  extraTokens: any
  hiddenTokens: any
  collectibles: any
  requestOtherProtocolsRefresh: () => Promise<any>
  onAddExtraToken: (extraToken: any) => void
  onRemoveExtraToken: (address: any) => void
  onAddHiddenToken: (hiddenToken: any) => void
  onRemoveHiddenToken: (address: any) => void
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
  onMessage: any
  getBalances: any
}
