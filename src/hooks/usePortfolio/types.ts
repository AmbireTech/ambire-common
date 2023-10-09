// TODO: fill in the collectibles types

import { Account } from 'ambire-common/src/hooks/useAccounts'

import { NETWORKS } from '../../constants/networks'
import { SupportedProtocolType } from '../../constants/supportedProtocols'
import { UseConstantsReturnType } from '../useConstants'
import { UseRelayerDataReturnType } from '../useRelayerData'
import { UseStorageType } from '../useStorage'
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

// TODO: Temporary type. Token doesn't always have this flag.
// Figure out in which use-cases it's needed.
export interface TokenWithIsHiddenFlag extends Token {
  isHidden: boolean
}

export type Network = keyof typeof NETWORKS

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
  useConstants: () => UseConstantsReturnType
  currentNetwork: Network
  account: string
  useStorage: UseStorageType
  isVisible: boolean
  useToasts: () => UseToastsReturnType
  getBalances: (
    network: Network,
    protocol: string,
    address: string,
    provider?: SupportedProtocolType['balancesProvider'],
    quickResponse?: boolean
  ) => Promise<any>
  getCoingeckoPrices: (ids: string[], vs_currencies: string[]) => Promise<any>
  getCoingeckoPriceByContract: (
    contractAddress: string,
    vs_currencies: string[]
  ) => Promise<{ [key: string]: number }>
  getCoingeckoCoin: (id: string, vs_currencies: string[]) => Promise<{ [key: string]: number }>
  relayerURL: string
  useRelayerData: () => UseRelayerDataReturnType
  eligibleRequests: any[]
  requests: any[]
  selectedAccount: string | null
  sentTxn: any
  useCacheStorage: UseStorageType
  accounts: Account[]
}

export type UseExtraTokensProps = {
  tokens: Token[]
  useStorage: UseStorageType
  useToasts: () => UseToastsReturnType
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
