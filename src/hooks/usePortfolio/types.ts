// TODO: fill in the collectibles types

import { NETWORKS } from 'constants/networks'
import { SupportedProtocolType } from 'constants/supportedProtocols'

import { UseStorageProps, UseStorageReturnType } from '../useStorage'
import { UseToastsReturnType } from '../useToasts'

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

type Network = keyof typeof NETWORKS

export type Balance = {
  network: Network
  total: {
    decimals: string
    full: number
    truncated: string
  }
}

export type Protocol = {
  address: string
  balance: number
  balanceRaw: string
  balanceUSD: number
  decimals: number
  isHidden: boolean
  network: Network
  price: number
  symbol: string
  tokenImageUrl: string
  type: string
  updateAt: string
}

export type Protocols = {
  assets: Protocol[]
  label: string
}

export type UsePortfolioProps = {
  currentNetwork: Network
  account: string
  useStorage: (p: Omit<UseStorageProps, 'storage'>) => UseStorageReturnType
  isVisible: boolean
  useToasts: () => UseToastsReturnType
  getBalances: (
    network: SupportedProtocolType['network'],
    protocol: string,
    address: string,
    provider?: SupportedProtocolType['balancesProvider']
  ) => Promise<any>
}

export type UsePortfolioReturnType = {
  balance: Balance
  otherBalances: Balance[]
  tokens: Token[]
  protocols: Protocols
  extraTokens: Token[]
  hiddenTokens: Token[]
  collectibles: any[]
  requestOtherProtocolsRefresh: () => Promise<any>
  onAddExtraToken: (extraToken: Token) => void
  onRemoveExtraToken: (address: Token['address']) => void
  onAddHiddenToken: (hiddenToken: Token) => void
  onRemoveHiddenToken: (address: Token['address']) => void
  balancesByNetworksLoading: Partial<{
    [key in Network]: boolean
  }>
  isCurrNetworkBalanceLoading: boolean
  areAllNetworksBalancesLoading: () => boolean
  otherProtocolsByNetworksLoading: Partial<{
    [key in Network]: boolean
  }>
  isCurrNetworkProtocolsLoading: boolean
  loadBalance: () => void
  loadProtocols: () => void
}
