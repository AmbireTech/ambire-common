import { Account } from '../useAccounts/types'
import { UseRelayerDataProps, UseRelayerDataReturnType } from '../useRelayerData'

export enum RewardIds {
  ADX_REWARDS = 'adx-rewards',
  BALANCE_REWARDS = 'balance-rewards',
  ADX_TOKEN_APY = 'adxTokenAPY'
}

export type UseRewardsProps = {
  relayerURL: string
  accountId: Account['id']
  useRelayerData: (props: Omit<UseRelayerDataProps, 'fetch'>) => UseRelayerDataReturnType
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
  // TODO: Double-check if these are all incoming props fro the Relayer
  text: string
  resources: {
    link1: {
      href: string
      label: string
    }
    emojies?: {
      [key in 'e1' | 'e2' | 'e3']: { text: string; size: string }
    }
  }
  period: {
    from: number
    to: number
    timer: boolean
  }
}

export type RelayerRewardsData = {
  data: {
    adxTokenAPY: number
    multipliers: Multiplier[]
    rewards: Reward[]
    success: boolean
    usdPrice: number
    walletTokenAPY: number
    xWALLETAPY: number
    promo?: null | Promo
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
  walletUsdPrice: number
  xWALLETAPY: number
  xWALLETAPYPercentage: string
  totalLifetimeRewards: number
  promo?: null | Promo
}

export interface UseRewardsReturnType {
  isLoading: boolean
  errMsg: null | any
  rewards: RewardsState
}
