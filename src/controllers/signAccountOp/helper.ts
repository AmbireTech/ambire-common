import { ZeroAddress } from 'ethers'

import { FeePaymentOption } from '../../libs/estimate/interfaces'

export function getFeeSpeedIdentifier(option: FeePaymentOption, accountAddr: string) {
  // if the token is native and we're paying with EOA, we do not need
  // a different identifier as the fee speed calculations will be the same
  // regardless of the EOA address
  const paidBy =
    option.token.address === ZeroAddress && option.paidBy !== accountAddr ? 'EOA' : option.paidBy

  return `${paidBy}:${option.token.address}:${
    option.token.flags.onGasTank ? 'gasTank' : 'feeToken'
  }`
}
