import { formatUnits, ZeroAddress } from 'ethers'

import { FeePaymentOption } from '../../libs/estimate/interfaces'
import { Price, TokenResult } from '../../libs/portfolio'

export function getFeeSpeedIdentifier(option: FeePaymentOption, accountAddr: string) {
  // if the token is native and we're paying with EOA, we do not need
  // a different identifier as the fee speed calculations will be the same
  // regardless of the EOA address
  const paidBy =
    option.token.address === ZeroAddress && option.paidBy !== accountAddr ? 'EOA' : option.paidBy

  return `${paidBy}:${option.token.address}:${option.token.symbol.toLowerCase()}:${
    option.token.flags.onGasTank ? 'gasTank' : 'feeToken'
  }`
}

export function getTokenUsdAmount(token: TokenResult, gasAmount: bigint): string {
  const isUsd = (price: Price) => price.baseCurrency === 'usd'
  const usdPrice = token.priceIn.find(isUsd)?.price

  if (!usdPrice) return ''

  const usdPriceFormatted = BigInt(usdPrice * 1e18)

  // 18 it's because we multiply usdPrice * 1e18 and here we need to deduct it
  return formatUnits(BigInt(gasAmount) * usdPriceFormatted, 18 + token.decimals)
}
