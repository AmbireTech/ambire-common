import { Contract, ZeroAddress } from 'ethers'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import feeTokens from '../../consts/feeTokens'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { Account } from '../../interfaces/account'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { RPCProvider } from '../../interfaces/settings'
import batcher from './batcher'
import { geckoRequestBatcher, geckoResponseIdentifier } from './gecko'

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

export const validateERC20Token = async (
  token: { address: string; networkId: NetworkId },
  accountId: string,
  provider: RPCProvider,
  network: NetworkDescriptor
) => {
  const erc20 = new Contract(token?.address, IERC20.abi, provider)

  const type = 'erc20'
  let isValid = true
  let hasError = false
  const batchedGecko = await batcher(fetch, geckoRequestBatcher)

  const [amount, symbol, decimals] = (await Promise.all([
    erc20.balanceOf(accountId).catch(() => {
      hasError = true
    }),
    erc20.symbol().catch(() => {
      hasError = true
    }),
    erc20.decimals().catch(() => {
      hasError = true
    })
  ]).catch(() => {
    hasError = true
    isValid = false
  })) || [undefined, undefined, undefined]

  const priceIn = await batchedGecko({
    address: token?.address,
    network,
    baseCurrency: 'usd',
    // this is what to look for in the coingecko response object
    responseIdentifier: geckoResponseIdentifier(token?.address, network)
  }).catch(() => {})

  if (
    typeof amount === 'undefined' ||
    typeof symbol === 'undefined' ||
    typeof decimals === 'undefined'
  ) {
    isValid = false
  }

  isValid = isValid && !hasError

  return [
    isValid,
    type,
    symbol,
    amount,
    decimals,
    priceIn && [{ baseCurrency: 'usd', price: priceIn?.usd }]
  ]
}

export const shouldGetAdditionalPortfolio = (account?: Account) => {
  // portfolio additional data is available only for smart accounts
  return !!account?.creation
}
