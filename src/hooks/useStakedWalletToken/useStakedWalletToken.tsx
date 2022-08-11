import { Contract } from 'ethers'
import { formatUnits, Interface } from 'ethers/lib/utils'
import { useCallback, useEffect, useState } from 'react'

import WalletStakingPoolABI from '../../constants/abis/WalletStakingPoolABI.json'
import { NETWORKS } from '../../constants/networks'
import { getProvider } from '../../services/provider'
import { UseStakedWalletTokenProps, UseStakedWalletTokenReturnType } from './types'

const WALLET_STAKING_ADDRESS = '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935'
const WALLET_STAKING_POOL_INTERFACE = new Interface(WalletStakingPoolABI)

const provider = getProvider(NETWORKS.ethereum)
const stakingWalletContract = new Contract(
  WALLET_STAKING_ADDRESS,
  WALLET_STAKING_POOL_INTERFACE,
  provider
)

const useStakedWalletToken = ({
  accountId
}: UseStakedWalletTokenProps): UseStakedWalletTokenReturnType => {
  const [stakedAmount, setStakedAmount] = useState(0)

  const fetchStakedWalletData = useCallback(async () => {
    try {
      const [balanceOf, shareValue] = await Promise.all([
        stakingWalletContract.balanceOf(accountId),
        stakingWalletContract.shareValue()
      ])

      const amount = +formatUnits(balanceOf.toString(), 18) * +formatUnits(shareValue, 18)
      setStakedAmount(amount)
    } catch (e) {
      // Fail silently
    }
  }, [accountId])

  useEffect(() => {
    fetchStakedWalletData()
  }, [fetchStakedWalletData])

  return { stakedAmount }
}

export default useStakedWalletToken
