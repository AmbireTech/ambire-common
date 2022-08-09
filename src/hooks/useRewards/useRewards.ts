import { useEffect, useState } from 'react'

import useCacheBreak from '../useCacheBreak'
import { Multiplier, RelayerRewardsData, RewardIds, UseRewardsProps } from './types'

const initialState = {
  data: {
    adxTokenAPY: 0,
    multipliers: [],
    rewards: [],
    success: false,
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
  walletUsdPrice: 0,
  xWALLETAPY: 0
}

type RewardsState = {
  [key in RewardIds]: number
} & {
  multipliers: Multiplier[]
  walletTokenAPY: number
  walletUsdPrice: number
  xWALLETAPY: number
}

export default function useRewards({
  relayerURL,
  useAccounts,
  useRelayerData,
  useClaimableWalletToken
}: UseRewardsProps) {
  const claimableWalletToken = useClaimableWalletToken()
  const { account, selectedAcc } = useAccounts()
  const { cacheBreak } = useCacheBreak()
  // TODO: type for this state
  const [rewards, setRewards] = useState<RewardsState>(rewardsInitialState)

  const rewardsUrl =
    !!relayerURL &&
    !!selectedAcc &&
    `${relayerURL}/wallet-token/rewards/${selectedAcc}?cacheBreak=${cacheBreak}`
  const { isLoading, data, errMsg } = useRelayerData(rewardsUrl, initialState) as RelayerRewardsData

  useEffect(() => {
    if (errMsg || !data || !data.success) return
    // TODO: Figure out if these are still needed
    // if (!data.rewards.length) return
    // if (account?.id) return

    const rewardsDetails = Object.fromEntries(
      data.rewards.map(({ _id, rewards: r }) => [_id, r[account.id] || 0])
    )
    // TODO: Figure out why types mismatch
    rewardsDetails.multipliers = data.multipliers
    rewardsDetails.walletTokenAPY = data.walletTokenAPY
    rewardsDetails.adxTokenAPY = data.adxTokenAPY
    rewardsDetails.walletUsdPrice = data.usdPrice
    rewardsDetails.xWALLETAPY = data.xWALLETAPY
    setRewards(rewardsDetails)
  }, [account.id, data, errMsg])

  const totalLifetimeRewards = data.rewards
    ?.map((x) => (typeof x.rewards[account.id] === 'number' ? x.rewards[account.id] : 0))
    .reduce((a, b) => a + b, 0)

  const pendingTokensTotal =
    claimableWalletToken.currentClaimStatus && !claimableWalletToken.currentClaimStatus.loading
      ? (
          (totalLifetimeRewards || 0) -
          (claimableWalletToken.currentClaimStatus.claimed || 0) -
          (claimableWalletToken.currentClaimStatus.claimedInitial || 0) +
          (claimableWalletToken.currentClaimStatus.mintableVesting || 0)
        ).toFixed(3)
      : '...'

  return {
    isLoading,
    errMsg,
    data,
    rewards,
    pendingTokensTotal,
    claimableWalletToken
  }
}
