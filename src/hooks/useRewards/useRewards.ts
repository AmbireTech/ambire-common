import { useEffect, useState } from 'react'

import useCacheBreak from '../useCacheBreak'
import { Multiplier, RelayerRewardsData, RewardIds, UseRewardsProps } from './types'

const initialState = {
  data: {
    adxTokenAPY: 0,
    multipliers: [],
    rewards: [],
    success: true,
    usdPrice: 0,
    walletTokenAPY: 0,
    xWALLETAPY: 0
  },
  errMsg: null,
  isLoading: true
}

const rewardsInitialState = {
  [RewardIds.ADX_REWARDS]: 0,
  [RewardIds.BALANCE_REWARDS]: 0,
  [RewardIds.ADX_TOKEN_APY]: 0,
  multipliers: [],
  walletTokenAPY: 0,
  walletTokenAPYPercentage: '...',
  adxTokenAPYPercentage: '...',
  walletUsdPrice: 0,
  xWALLETAPY: 0,
  xWALLETAPYPercentage: '...',
  totalLifetimeRewards: 0
}

type RewardsState = {
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

export default function useRewards({ relayerURL, useAccounts, useRelayerData }: UseRewardsProps) {
  const { selectedAcc } = useAccounts()
  const { cacheBreak } = useCacheBreak()
  const [rewards, setRewards] = useState<RewardsState>(rewardsInitialState)

  const rewardsUrl =
    !!relayerURL &&
    !!selectedAcc &&
    `${relayerURL}/wallet-token/rewards/${selectedAcc}?cacheBreak=${cacheBreak}`
  const { isLoading, data, errMsg } = useRelayerData(rewardsUrl, initialState) as RelayerRewardsData

  useEffect(() => {
    if (errMsg || !data.success || isLoading) return
    if (!data.rewards.length) return

    const rewardsDetails = Object.fromEntries<
      string | number | Multiplier[] | { [key in RewardIds]: number }
    >(data.rewards.map(({ _id, rewards: r }) => [_id, r[selectedAcc] || 0]))
    rewardsDetails.multipliers = data.multipliers
    rewardsDetails.walletTokenAPY = data.walletTokenAPY // TODO: Remove if not used anyhwere else raw
    rewardsDetails.walletTokenAPYPercentage = data.walletTokenAPY
      ? `${(data.walletTokenAPY * 100).toFixed(2)}%`
      : // TODO: Check if displaying 0 is better
        '...'
    rewardsDetails.adxTokenAPY = data.adxTokenAPY // TODO: Remove if not used anyhwere else raw
    rewardsDetails.adxTokenAPYPercentage = data.adxTokenAPY
      ? `${(data.adxTokenAPY * 100).toFixed(2)}%`
      : // TODO: Check if displaying 0 is better
        '...'
    rewardsDetails.walletUsdPrice = data.usdPrice || 0 // TODO: Remove if not used anyhwere else raw
    rewardsDetails.xWALLETAPY = data.xWALLETAPY
    rewardsDetails.xWALLETAPYPercentage = data.xWALLETAPY
      ? `${(data.xWALLETAPY * 100).toFixed(2)}%`
      : // TODO: Check if displaying 0 is better
        '...'

    rewardsDetails.totalLifetimeRewards = data.rewards
      .map((x) => (typeof x.rewards[selectedAcc] === 'number' ? x.rewards[selectedAcc] : 0))
      .reduce((a, b) => a + b, 0)

    setRewards(rewardsDetails as RewardsState)
  }, [selectedAcc, data, errMsg, isLoading])

  return {
    isLoading,
    errMsg,
    rewards
  }
}
