import { UseAccountsReturnType } from '../useAccounts'
import { Account } from '../useAccounts/types'
import { UseRelayerDataReturnType } from '../useRelayerData'

export enum RewardIds {
  ADX_REWARDS = 'adx-rewards',
  BALANCE_REWARDS = 'balance-rewards',
  ADX_TOKEN_APY = 'adxTokenAPY'
}

export type UseRewardsProps = {
  relayerURL: string
  useAccounts: () => UseAccountsReturnType
  useRelayerData: (url: string | null | boolean, initialState?: any) => UseRelayerDataReturnType
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

export type RelayerRewardsData = {
  data: {
    adxTokenAPY: number
    multipliers: Multiplier[]
    rewards: Reward[]
    success: boolean
    usdPrice: number
    walletTokenAPY: number
    xWALLETAPY: number
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
}

export interface UseRewardsReturnType {
  isLoading: boolean
  errMsg: null | any
  rewards: RewardsState
}
