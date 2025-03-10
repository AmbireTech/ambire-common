import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces'
import { TokenResult } from '../portfolio'

export abstract class BaseAccount {
  protected account: Account

  constructor(account: Account) {
    this.account = account
  }

  getAccount() {
    return this.account
  }

  // each implementation should declare when an estimation failure is critical
  // and we should display it to the user
  abstract getEstimationCriticalError(estimation: FullEstimation): Error | null

  abstract getAvailableFeeOptions(
    estimation: FullEstimationSummary,
    network: Network,
    feePaymentOptions: FeePaymentOption[]
  ): FeePaymentOption[]

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

  abstract getBroadcastOption(
    feeOption: FeePaymentOption,
    options: {
      network: Network
      op: AccountOp
      accountState: AccountOnchainState
    }
  ): string
}
