import { Account } from '../useAccounts/types'
import { UseRelayerDataProps, UseRelayerDataReturnType } from '../useRelayerData'

export enum RewardIds {
  ADX_REWARDS = 'adx-rewards',
  BALANCE_REWARDS = 'balance-rewards',
  ADX_TOKEN_APY = 'adxTokenAPY'
}

export enum RewardsSource {
  UNSET = 'unset',
  WEB = 'web',
  ANDROID = 'android',
  IOS = 'ios',
  EXTENSION = 'extension'
}

export type UseRewardsProps = {
  relayerURL: string
  accountId: Account['id']
  useRelayerData: (props: Omit<UseRelayerDataProps, 'fetch'>) => UseRelayerDataReturnType
  source?: RewardsSource
}

export type Multiplier = {
  mul: number
  name: Text
}

type Reward = {
  _id: string
  rewards: {
    [key in Account['id']]: number
  }
  updated: string // timestamp
}

export type Promo = {
  id: string
  title: string
  icon: string // emoji
  type: string
  // The `text` could contain string literals which represent links, match those
  // links with the `resources` object and replace the string literal, example:
  //   text: "As an early user of the Ambire app we exclusively invite you to
  //   download the Ambire mobile app. ${{linkiOS}} ${{linkAndroid}}"
  text: string
  // In the `resources` object the `key`(s) will match the string literals,
  // defined in the `text` prop. Match them by using the `label` prop to
  // replace the string literal and use the `href` prop to link.
  resources: {
    [key: string]: {
      href: string
      label: string
    }
  }
  period: {
    from: string // timestamp
    to: string // timestamp
    timer: boolean
  }
}

export type ExtensionKey = {
  key: string
  used: boolean
}

export type RelayerRewardsBalance = {
  balanceFromADX: number
  balanceInUSD: number
  effectiveBalanceInUSD: number
  adxRewards?: number
  balanceRewards?: number
  adxTokenAPY?: number
}

export type RelayerRewardsData = {
  data: {
    claimableRewardsData: any
    adxTokenAPY: number
    multipliers: Multiplier[]
    rewards: Reward[]
    success: boolean
    usdPrice: number
    walletTokenAPY: number
    xWALLETAPY: number
    promo?: null | Promo
    balance: RelayerRewardsBalance
    extensionKey: ExtensionKey
  }
  errMsg: null
  isLoading: boolean
}

export type RewardsState = {
  [key in RewardIds]: number
} & {
  multipliers: Multiplier[]
  walletTokenAPY: number
  walletTokenAPYPercentage: string
  adxTokenAPYPercentage: string
  adxTokenAPY: number
  walletUsdPrice: number
  xWALLETAPY: number
  xWALLETAPYPercentage: string
  totalLifetimeRewards: number
  promo?: null | Promo
  balance: RelayerRewardsBalance
  extensionKey: ExtensionKey
}

export interface UseRewardsReturnType {
  lastUpdated: null | number
  isLoading: boolean
  errMsg: null | any
  rewards: RewardsState
}
