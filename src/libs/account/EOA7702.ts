/* eslint-disable class-methods-use-this */
import { FeePaymentOption } from '../estimate/interfaces'
import { BaseAccount } from './BaseAccount'

// this class describes an EOA that CAN transition to 7702
// even if it is YET to transition to 7702
export class EOA7702 extends BaseAccount {
  getAvailableFeeOptions(feePaymentOptions: FeePaymentOption[]): FeePaymentOption[] {
    return feePaymentOptions.filter(
      (opt) => opt.paidBy === this.account.addr && opt.availableAmount > 0n
    )
  }
}
