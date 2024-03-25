import { ZeroAddress } from 'ethers'

import feeTokens from '../../consts/feeTokens'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { Account } from '../../interfaces/account'
import { NetworkId } from '../../interfaces/networkDescriptor'

export function getFlags(
  networkData: any,
  networkId: NetworkId,
  tokenNetwork: NetworkId,
  address: string
) {
  const onGasTank = networkId === 'gasTank'
  let rewardsType = null
  if (networkData?.xWalletClaimableBalance?.address === address) rewardsType = 'wallet-rewards'
  if (networkData?.walletClaimableBalance?.address === address) rewardsType = 'wallet-vesting'

  const canTopUpGasTank = gasTankFeeTokens.some(
    (t) =>
      t.address === address &&
      (onGasTank || networkId === 'rewards'
        ? t.networkId === tokenNetwork
        : t.networkId === networkId)
  )

  // if the address is 0, it's always a fee token
  const isFeeToken =
    address !== ZeroAddress
      ? feeTokens.some(
          (t) =>
            t.address === address &&
            (onGasTank || networkId === 'rewards'
              ? t.networkId === tokenNetwork
              : t.networkId === networkId)
        )
      : true

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
