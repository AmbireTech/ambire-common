import { Contract } from 'ethers'
import { Interface } from 'ethers/lib/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'

import WALLETSupplyControllerABI from '../../constants/abis/WALLETSupplyControllerABI.json'
import { NETWORKS } from '../../constants/networks'
import WALLETVestings from '../../constants/WALLETVestings.json'
import { getProvider } from '../../services/provider'
import useCacheBreak from '../useCacheBreak'
import { UseClaimableWalletTokenProps, UseClaimableWalletTokenReturnType } from './types'

// const supplyControllerAddress = '0xF8cF66BbF7fe152b8177B61855E8be9a6279C8A1' //test polygon
const supplyControllerAddress = '0xA23C1bf0D0988DF467E9156a33A32f6BA6a9AF52'
const WALLET_STAKING_ADDR = '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935'
const supplyControllerInterface = new Interface(WALLETSupplyControllerABI)
const NETWORK_NAME = NETWORKS.ethereum

const useClaimableWalletToken = ({
  relayerURL,
  useRelayerData,
  accountId,
  network,
  addRequest,
  totalLifetimeRewards,
  walletUsdPrice
}: UseClaimableWalletTokenProps): UseClaimableWalletTokenReturnType => {
  const { cacheBreak: relayerCacheBreak } = useCacheBreak()
  const urlIdentityRewards = relayerURL
    ? `${relayerURL}/wallet-token/rewards/${accountId}?cacheBreak=${relayerCacheBreak}`
    : null

  const rewardsData = useRelayerData({ url: urlIdentityRewards })
  const claimableRewardsData = rewardsData?.data?.claimableRewardsData || null
  const provider = useMemo(() => getProvider(NETWORK_NAME), [])
  const supplyController = useMemo(
    () => new Contract(supplyControllerAddress, WALLETSupplyControllerABI, provider),
    [provider]
  )

  const vestingEntry = useMemo(() => WALLETVestings.find((x) => x.addr === accountId), [accountId])

  const [currentClaimStatus, setCurrentClaimStatus] = useState({
    loading: true,
    claimed: 0,
    mintableVesting: 0,
    claimedInitial: 0,
    error: null
  })

  // By adding this to the deps, we make it refresh every 10 mins
  const { cacheBreak } = useCacheBreak({ refreshInterval: 10000, breakPoint: 5000 })
  useEffect(() => {
    setCurrentClaimStatus((prev) => ({ ...prev, loading: true, error: null }))
    ;(async () => {
      const toNum = (x: string | number) => parseInt(x.toString(), 10) / 1e18
      const [mintableVesting, claimed] = await Promise.all([
        vestingEntry
          ? await supplyController
              .mintableVesting(vestingEntry.addr, vestingEntry.end, vestingEntry.rate)
              .then(toNum)
          : null,
        claimableRewardsData
          ? await supplyController.claimed(claimableRewardsData.addr).then(toNum)
          : null
      ])
      // fromBalanceClaimable - all time claimable from balance
      // fromADXClaimable - all time claimable from ADX Staking
      // totalClaimable - all time claimable tolkens + already claimed from prev versions of supplyController contract
      const claimedInitial = claimableRewardsData
        ? (claimableRewardsData.fromBalanceClaimable || 0) +
          (claimableRewardsData.fromADXClaimable || 0) -
          toNum(claimableRewardsData.totalClaimable || 0)
        : 0

      return { mintableVesting, claimed, claimedInitial }
    })()
      .then((status) => setCurrentClaimStatus({ error: null, loading: false, ...status }))
      .catch((e) => {
        console.error('getting claim status', e)

        setCurrentClaimStatus({
          error: e.message || e,
          loading: false,
          claimed: 0,
          mintableVesting: 0,
          claimedInitial: 0
        })
      })

  }, [supplyController, vestingEntry, claimableRewardsData, cacheBreak])

  const initialClaimable = claimableRewardsData ? +claimableRewardsData.totalClaimable / 1e18 : 0
  const claimableNowRounded = +(initialClaimable - (currentClaimStatus.claimed || 0)).toFixed(6)
  const claimableNow = claimableNowRounded < 0 ? 0 : claimableNowRounded

  const claimableNowUsd = (walletUsdPrice * claimableNow).toFixed(2)
  const mintableVestingUsd = (walletUsdPrice * currentClaimStatus.mintableVesting).toFixed(2)

  const pendingTokensTotal = (
    totalLifetimeRewards -
    currentClaimStatus.claimed -
    currentClaimStatus.claimedInitial +
    currentClaimStatus.mintableVesting
  ).toFixed(3)

  const shouldDisplayMintableVesting = !!currentClaimStatus.mintableVesting && !!vestingEntry

  let disabledReason = ''
  if (network?.id !== NETWORKS.ethereum) {
    disabledReason = 'Switch to Ethereum to claim'
  } else if (currentClaimStatus.error) {
    disabledReason = `Claim status error: ${currentClaimStatus.error}`
  }
  const claimDisabledReason = claimableNow === 0 ? 'No rewards are claimable' : ''
  const claimingDisabled = !!(claimDisabledReason || disabledReason)

  const claimEarlyRewards = useCallback(
    (withoutBurn = true) => {
      addRequest({
        id: `claim_${Date.now()}`,
        chainId: network?.chainId,
        type: 'eth_sendTransaction',
        account: accountId,
        txn: {
          to: supplyControllerAddress,
          value: '0x0',
          data: supplyControllerInterface.encodeFunctionData('claimWithRootUpdate', [
            claimableRewardsData?.totalClaimable,
            claimableRewardsData?.proof,
            withoutBurn ? 0 : 5000, // penalty bps, at the moment we run with 0; it's a safety feature to hardcode it
            WALLET_STAKING_ADDR, // staking pool addr
            claimableRewardsData?.root,
            claimableRewardsData?.signedRoot,
          ])
        }
      })
    },
    [claimableRewardsData, network?.chainId, accountId, addRequest]
  )
  const claimVesting = useCallback(() => {
    addRequest({
      id: `claimVesting_${Date.now()}`,
      chainId: network?.chainId,
      account: accountId,
      type: 'eth_sendTransaction',
      txn: {
        to: supplyControllerAddress,
        value: '0x0',
        data: supplyControllerInterface.encodeFunctionData('mintVesting', [
          vestingEntry?.addr,
          vestingEntry?.end,
          vestingEntry?.rate
        ])
      }
    })
  }, [vestingEntry, network?.chainId, accountId, addRequest])

  return {
    vestingEntry,
    shouldDisplayMintableVesting,
    currentClaimStatus,
    claimableNow,
    disabledReason,
    claimDisabledReason,
    claimEarlyRewards,
    claimVesting,
    pendingTokensTotal,
    claimableNowUsd,
    mintableVestingUsd,
    claimingDisabled
  }
}

export default useClaimableWalletToken
