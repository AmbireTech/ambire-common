import { FeePaymentOption } from '../../libs/estimate/interfaces'

export function getFeeSpeedIdentifier(option: FeePaymentOption) {
  return `${option.paidBy}:${option.token.address}:${
    option.token.flags.onGasTank ? 'gasTank' : 'feeToken'
  }`
}
