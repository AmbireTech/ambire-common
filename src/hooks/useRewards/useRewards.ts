import { useEffect, useState } from 'react'

import useCacheBreak from '../useCacheBreak'
import {
  ExtensionKey,
  Multiplier,
  Promo,
  RelayerRewardsBalance,
  RelayerRewardsData,
  RewardIds,
  RewardsSource,
  RewardsState,
  UseRewardsProps,
  UseRewardsReturnType
} from './types'

const initialState = {
  data: {
    adxTokenAPY: 0,
    multipliers: [],
    rewards: [],
    success: true,
    usdPrice: 0,
    walletTokenAPY: 0,
    xWALLETAPY: 0,
    promo: null,
    balance: {
      balanceFromADX: 0,
      balanceInUSD: 0,
      effectiveBalanceInUSD: 0
    },
    extensionKey: {
      key: '',
      used: false
    }
  },
  errMsg: null,
  isLoading: true
}

const rewardsInitialState = {
  accountAddr: '',
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
  totalLifetimeRewards: 0,
  promo: null,
  balance: {
    balanceFromADX: 0,
    balanceInUSD: 0,
    effectiveBalanceInUSD: 0
  },
  extensionKey: {
    key: '',
    used: false
  }
}

export default function useRewards({
  relayerURL,
  accountId,
  useRelayerData,
  source = RewardsSource.UNSET
}: UseRewardsProps): UseRewardsReturnType {
  const { cacheBreak } = useCacheBreak()
  const [rewards, setRewards] = useState<RewardsState>(rewardsInitialState)
  const [lastUpdated, setLastUpdated] = useState<null | number>(null)

  const rewardsUrl =
    !!relayerURL &&
    !!accountId &&
    `${relayerURL}/wallet-token/rewards/${accountId}?cacheBreak=${cacheBreak}&source=${source}`
  const { isLoading, data, errMsg } = useRelayerData({
    url: rewardsUrl,
    initialState
  }) as RelayerRewardsData

  useEffect(() => {
    if (errMsg || !data?.success || isLoading) return

    const rewardsDetails = Object.fromEntries<
      | string
      | number
      | Multiplier[]
      | Promo
      | ExtensionKey
      | { [key in RewardIds]: number }
      | RelayerRewardsBalance
    >(data.rewards.map(({ _id, rewards: r }) => [_id, r[accountId] || 0]))
    rewardsDetails.accountAddr = data.claimableRewardsData.addr
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

    rewardsDetails.balance = data.balance

    rewardsDetails.totalLifetimeRewards = data.rewards
      .map((x) => (typeof x.rewards[accountId] === 'number' ? x.rewards[accountId] : 0))
      .reduce((a, b) => a + b, 0)

    rewardsDetails.promo = (data.promo as Promo) || null
    rewardsDetails.extensionKey = data.extensionKey

    setRewards(rewardsDetails as RewardsState)
    setLastUpdated(Date.now())
  }, [accountId, data, errMsg, isLoading])

  return {
    lastUpdated,
    isLoading,
    errMsg,
    rewards
  }
}
