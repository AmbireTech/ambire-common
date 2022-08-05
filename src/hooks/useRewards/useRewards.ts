import { useEffect, useState } from 'react'

import useCacheBreak from '../useCacheBreak'
import { UseRewardsProps } from './types'

export default function useRewards({
  relayerURL,
  useAccounts,
  useRelayerData,
  useClaimableWalletToken
}: UseRewardsProps) {
  const claimableWalletToken = useClaimableWalletToken()
  const { account, selectedAcc } = useAccounts()
  const { cacheBreak } = useCacheBreak()

  // TODO: Convert this to a `useEffect` hook
  const rewardsUrl =
    relayerURL && selectedAcc
      ? `${relayerURL}/wallet-token/rewards/${selectedAcc}?cacheBreak=${cacheBreak}`
      : null
  // TODO: Types of the rewards data.
  // TODO: Skip if `null`.
  const rewardsData = useRelayerData(rewardsUrl)

  const totalLifetimeRewards = rewardsData.data?.rewards
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
  // TODO: type for this state
  const [rewards, setRewards] = useState({})
  const { isLoading, data, errMsg } = rewardsData

  // TODO: Double check if this is disabled on the web app too
  // const showWalletTokenModal = useDynamicModal(
  //   WalletTokenModal,
  //   { claimableWalletToken, accountId: account.id },
  //   { rewards }
  // )

  useEffect(() => {
    if (errMsg || !data || !data.success) return

    if (!data.rewards.length) return

    const rewardsDetails = Object.fromEntries(
      data.rewards.map(({ _id, rewards }) => [_id, rewards[account.id] || 0])
    )
    rewardsDetails.multipliers = data.multipliers
    rewardsDetails.walletTokenAPY = data.walletTokenAPY
    rewardsDetails.adxTokenAPY = data.adxTokenAPY
    rewardsDetails.walletUsdPrice = data.usdPrice
    rewardsDetails.xWALLETAPY = data.xWALLETAPY
    setRewards(rewardsDetails)
  }, [data, errMsg, account])

  return {
    isLoading,
    errMsg,
    data,
    rewards,
    pendingTokensTotal,
    claimableWalletToken
  }
}
