/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces'
import { TokenResult } from '../portfolio'

export abstract class BaseAccount {
  protected account: Account

  protected network: Network

  protected accountState: AccountOnchainState

  constructor(account: Account, network: Network, accountState: AccountOnchainState) {
    this.account = account
    this.network = network
    this.accountState = accountState
  }

  getAccount() {
    return this.account
  }

  // each implementation should declare when an estimation failure is critical
  // and we should display it to the user
  abstract getEstimationCriticalError(estimation: FullEstimation): Error | null

  abstract supportsBundlerEstimation(): boolean

  abstract getAvailableFeeOptions(
    estimation: FullEstimationSummary,
    feePaymentOptions: FeePaymentOption[]
  ): FeePaymentOption[]

  abstract getGasUsed(
    estimation: FullEstimationSummary,
    // all of the options below need to be passed. Each implementation
    // decides on its own which are actually important for it
    options: {
      feeToken: TokenResult
      op: AccountOp
    }
  ): bigint

  abstract getBroadcastOption(
    feeOption: FeePaymentOption,
    options: {
      op: AccountOp
    }
  ): string

  // this is specific for v2 accounts, hardcoding a false for all else
  shouldIncludeActivatorCall(broadcastOption: string) {
    return false
  }

  // this is specific for eoa7702 accounts
  shouldSignAuthorization(broadcastOption: string): boolean {
    return false
  }
}
