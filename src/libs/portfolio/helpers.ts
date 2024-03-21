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
  if (networkData?.xWalletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
    rewardsType = 'wallet-rewards'
  if (networkData?.walletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
    rewardsType = 'wallet-vesting'

  const isFeeToken = gasTankFeeTokens.some(
    (t) =>
      t.address.toLowerCase() === address.toLowerCase() &&
      (['gasTank', 'rewards'].includes(networkId)
        ? t.networkId === tokenNetwork
        : t.networkId === networkId)
  )

  return {
    onGasTank,
    rewardsType,
    isFeeToken
  }
}

export const shouldGetAdditionalPortfolio = (account?: Account) => {
  // portfolio additional data is available only for smart accounts
  return !!account?.creation
}
