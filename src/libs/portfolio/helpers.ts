import { Contract, Interface } from 'ethers'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import IERC721 from '../../../contracts/compiled/IERC721.json'
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
  const isFeeToken = feeTokens.some(
    (t) =>
      t.address === address &&
      (onGasTank || networkId === 'rewards'
        ? t.networkId === tokenNetwork
        : t.networkId === networkId)
  )

  return {
    onGasTank,
    rewardsType,
    canTopUpGasTank,
    isFeeToken
  }
}

// TODO: better naming
export const checkTokenEligibility = async (token, accountId, provider) => {
  const ERC20Interface = new Interface(IERC20.abi)
  const ERC721Interface = new Interface(IERC721.abi)

  const erc20 = new Contract(token?.address, ERC20Interface, provider)
  const erc721 = new Contract(token?.address, ERC721Interface, provider)

  const response = await Promise.all([
    erc20.balanceOf(accountId).catch((e) => e),
    erc20.symbol().catch((e) => e),
    erc20.decimals().catch((e) => e)
  ]).catch((e) => e)

  const isNotEligible =
    response[0] instanceof Error && response[1] instanceof Error && response[2] instanceof Error
  console.log(response, isNotEligible)

  return !isNotEligible
}

export const shouldGetAdditionalPortfolio = (account?: Account) => {
  // portfolio additional data is available only for smart accounts
  return !!account?.creation
}
