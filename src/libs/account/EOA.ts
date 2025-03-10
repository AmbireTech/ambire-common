/* eslint-disable class-methods-use-this */
import { ZeroAddress } from 'ethers'
import { FeePaymentOption } from '../estimate/interfaces'
import { BaseAccount } from './BaseAccount'

// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class EOA extends BaseAccount {
  getAvailableFeeOptions(feePaymentOptions: FeePaymentOption[]): FeePaymentOption[] {
    const native = feePaymentOptions.find(
      (opt) =>
        opt.paidBy === this.account.addr &&
        opt.token.address === ZeroAddress &&
        !opt.token.flags.onGasTank
    )
    if (!native) throw new Error('no native fee payment option, it should not happen')
    return [native]
  }
}
