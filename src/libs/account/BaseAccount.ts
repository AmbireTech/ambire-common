import { Account } from '../../interfaces/account'
import { FeePaymentOption } from '../estimate/interfaces'

export abstract class BaseAccount {
  protected account: Account

  constructor(account: Account) {
    this.account = account
  }

  getAccount() {
    return this.account
  }

  abstract getAvailableFeeOptions(feePaymentOptions: FeePaymentOption[]): FeePaymentOption[]
}
