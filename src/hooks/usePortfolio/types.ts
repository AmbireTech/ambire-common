// TODO: fill in the collectibles types

import { Account } from 'ambire-common/src/hooks/useAccounts'

import { NETWORKS } from '../../constants/networks'
import { SupportedProtocolType } from '../../constants/supportedProtocols'
import { ConstantsType } from '../useConstants'
import { UseRelayerDataProps, UseRelayerDataReturnType } from '../useRelayerData'
import { UseStorageType } from '../useStorage'
import { UseToastsReturnType } from '../useToasts'

export type Token = {
  type: 'token'
  address: string
  decimals: number
  symbol: string
  name: string
  coingeckoId: string | null
  tokenImageUrl: string | null
  tokenImageUrls: {
    thumb: string
    small: string
    large: string
  } | null
  balance: number
  balanceRaw: string
  price: number
  balanceUSD: number
  priceUpdate: number
  balanceUpdate: number
  balanceOracleUpdate: number
  network: string
  latest: { balance: number; balanceUSD: number; balanceRaw: string }
  unconfirmed?: { balanceIncrease: number; balance: number; balanceUSD: number; difference: number }
  pending?: { balanceIncrease: number; balance: number; balanceUSD: number; difference: number }
}

export type Collectible = {
  type: 'nft'
  address: string
  decimals: number
  symbol: string
  price: number
  balance: string
  balanceUSD: number
  shouldDisplay: boolean
  collectionId: string
  collectionName: string
  collectionHidden: boolean
  collection: {
    id: string
    name: string
    hidden: boolean
  }
  assets: {
    tokenId: string
    balance: string
    original_owner: string
    token_url: string
    data: {
      name: string
      description: string
      image: string
      image_256: string
      image_512: string
      image_1024: string
      attributes?: {
        trait_type: string
        value: string
      }[]
    }
  }[]
}

export interface CollectibleWithIsHiddenFlag extends Collectible {
  assets: (Collectible['assets'][0] & { isHidden: boolean })[]
}
// TODO: Temporary type. Token doesn't always have this flag.
// Figure out in which use-cases it's needed.
export interface TokenWithIsHiddenFlag extends Token {
  isHidden: boolean
}

export type Network = keyof typeof NETWORKS

export type Balance = {
  network: Network | ''
  total: {
    decimals: string
    full: number
    truncated: string
  }
}

export type UsePortfolioProps = {
  useConstants: () => ConstantsType
  currentNetwork: Network
  account: string
  useStorage: UseStorageType
  isVisible: boolean
  useToasts: () => UseToastsReturnType
  getBalances: (
    network: Network,
    address: Account['id'],
    provider?: SupportedProtocolType['balancesProvider'] | undefined,
    quickResponse?: boolean | undefined
  ) => Promise<any> | null
  getCoingeckoPrices: (ids: string[], vs_currencies: string[]) => Promise<any>
  getCoingeckoPriceByContract: (
    contractAddress: string,
    vs_currencies: string[]
  ) => Promise<{ [key: string]: number }>
  getCoingeckoCoin: (id: string, vs_currencies: string[]) => Promise<{ [key: string]: number }>
  relayerURL: string
  useRelayerData: (props: Omit<UseRelayerDataProps, 'fetch'>) => UseRelayerDataReturnType
  eligibleRequests: any[]
  requests: any[]
  selectedAccount: {} | Account
  sentTxn: any
  useCacheStorage: UseStorageType
  accounts: Account[]
  requestPendingState: React.MutableRefObject<boolean>
}

export type UseExtraTokensProps = {
  checkIsTokenEligibleForAddingAsExtraToken: (extraToken: Token) => {
    isEligible: boolean
    reason?: string
  }
  tokens: Token[]
  useStorage: UseStorageType
  useToasts: () => UseToastsReturnType
}

export type UsePortfolioReturnType = {
  balance: Balance
  otherBalances: Balance[]
  tokens: Token[]
  extraTokens: Token[]
  hiddenTokens: Token[]
  collectibles: Collectible[]
  hiddenCollectibles: Collectible[]
  onAddExtraToken: (extraToken: Token) => void
  onRemoveExtraToken: (address: Token['address']) => void
  checkIsTokenEligibleForAddingAsExtraToken: UseExtraTokensProps['checkIsTokenEligibleForAddingAsExtraToken']
  onAddHiddenToken: (hiddenToken: Token) => void
  onAddHiddenCollectible: (
    hiddenCollectible: Collectible,
    tokenId: Collectible['assets'][0]['tokenId']
  ) => void
  onRemoveHiddenToken: (address: Token['address']) => void
  onRemoveHiddenCollectible: (
    address: Collectible['address'],
    tokenId: Collectible['assets'][0]['tokenId']
  ) => void
  balancesByNetworksLoading: Partial<{
    [key in Network]: boolean
  }>
  isCurrNetworkBalanceLoading: boolean
  loadBalance: () => void
  resultTime: number
}
