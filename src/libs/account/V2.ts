/* eslint-disable class-methods-use-this */
import { FeePaymentOption } from '../estimate/interfaces'
import { BaseAccount } from './BaseAccount'

// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class V2 extends BaseAccount {
  getAvailableFeeOptions(feePaymentOptions: FeePaymentOption[]): FeePaymentOption[] {
    return feePaymentOptions.filter((opt) => opt.availableAmount > 0n)
  }
}
