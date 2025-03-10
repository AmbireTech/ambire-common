import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { FeePaymentOption, FullEstimationSummary } from '../estimate/interfaces'
import { TokenResult } from '../portfolio'

export abstract class BaseAccount {
  protected account: Account

  constructor(account: Account) {
    this.account = account
  }

  getAccount() {
    return this.account
  }

  abstract getAvailableFeeOptions(feePaymentOptions: FeePaymentOption[]): FeePaymentOption[]

  abstract getGasUsed(
    estimation: FullEstimationSummary,
    // all of the options below need to be passed. Each implementation
    // decides on its own which are actually important for it
    options: {
      feeToken: TokenResult
      network: Network
      op: AccountOp
      accountState: AccountOnchainState
    }
  ): bigint
}
