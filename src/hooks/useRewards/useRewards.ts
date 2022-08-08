import { useEffect, useState } from 'react'

import useCacheBreak from '../useCacheBreak'
import { RewardsData, UseRewardsProps } from './types'

const rewardsInitialState = {
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

export default function useRewards({
  relayerURL,
  useAccounts,
  useRelayerData,
  useClaimableWalletToken
}: UseRewardsProps) {
  const claimableWalletToken = useClaimableWalletToken()
  const { account, selectedAcc } = useAccounts()
  const { cacheBreak } = useCacheBreak()
  const [{ isLoading, data, errMsg }, setRewardsData] = useState<RewardsData>(rewardsInitialState)
  // TODO: type for this state
  const [rewards, setRewards] = useState({})

  useEffect(() => {
    if (!relayerURL || !selectedAcc) return

    const rewardsUrl = `${relayerURL}/wallet-token/rewards/${selectedAcc}?cacheBreak=${cacheBreak}`
    console.log('fire')
    // FIXME: This breaks the hooks concept
    const rewardsData = useRelayerData(rewardsUrl) as RewardsData

    setRewardsData(rewardsData)
  }, [selectedAcc, relayerURL, cacheBreak, useRelayerData])

  useEffect(() => {
    if (errMsg || !data || !data.success) return
    if (!data?.rewards?.length) return
    if (account?.id) return

    const rewardsDetails = Object.fromEntries(
      data.rewards.map(({ _id, rewards: r }) => [_id, r[account.id] || 0])
    )
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
