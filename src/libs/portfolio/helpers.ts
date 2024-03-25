import { ZeroAddress } from 'ethers'

import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { Account } from '../../interfaces/account'
import { NetworkId } from '../../interfaces/networkDescriptor'

export function getFlags(
  networkData: any,
  networkId: NetworkId,
  tokenNetwork: NetworkId,
  address: string
) {
  const isRewardsOrGasTank = ['gasTank', 'rewards'].includes(networkId)
  const onGasTank = networkId === 'gasTank'

  let rewardsType = null
  if (networkData?.xWalletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
    rewardsType = 'wallet-rewards'
  if (networkData?.walletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
    rewardsType = 'wallet-vesting'

  const foundFeeToken = gasTankFeeTokens.find(
    (t) =>
      t.address.toLowerCase() === address.toLowerCase() &&
      (isRewardsOrGasTank ? t.networkId === tokenNetwork : t.networkId === networkId)
  )

  const canTopUpGasTank =
    address === ZeroAddress || (foundFeeToken && !foundFeeToken?.disableGasTankDeposit)
  const isFeeToken = address === ZeroAddress || !!foundFeeToken

  return {
    onGasTank,
    rewardsType,
    canTopUpGasTank,
    isFeeToken
  }
}

export const shouldGetAdditionalPortfolio = (account?: Account) => {
  // portfolio additional data is available only for smart accounts
  return !!account?.creation
}
