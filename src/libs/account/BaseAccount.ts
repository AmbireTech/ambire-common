/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import {
  BundlerStateOverride,
  FeePaymentOption,
  FullEstimation,
  FullEstimationSummary
} from '../estimate/interfaces'
import { TokenResult } from '../portfolio'
import { UserOperation } from '../userOperation/types'

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
  abstract getEstimationCriticalError(estimation: FullEstimation, op: AccountOp): Error | null

  abstract supportsBundlerEstimation(): boolean

  abstract getAvailableFeeOptions(
    estimation: FullEstimationSummary,
    feePaymentOptions: FeePaymentOption[],
    op: AccountOp
  ): FeePaymentOption[]

  abstract getGasUsed(
    estimation: FullEstimationSummary | Error,
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
      isSponsored?: boolean
    }
  ): string

  // can the account type use the receiving amount after the estimation
  // to pay the fee. Smart accounts can but EOA / 7702 EOAs cannot
  // as paying in native means broadcasting as an EOA - you have to
  // have the native before broadcast
  abstract canUseReceivingNativeForFee(amount: bigint): boolean

  // when using the ambire estimation, the broadcast gas is not included
  // so smart accounts that broadacast with EOAs/relayer do not have the
  // additional broadcast gas included
  //
  // Additionally, 7702 EOAs that use the ambire estimation suffer from
  // the same problem as they do broadcast by themselves by only
  // the smart account contract gas is calculated
  //
  // we return the calldata specific for each account to allow
  // the estimation to calculate it correctly
  abstract getBroadcastCalldata(accountOp: AccountOp): Hex

  // each account should declare if it supports atomicity
  abstract getAtomicStatus(): 'unsupported' | 'supported' | 'ready'

  /**
   * Get a unique identifier of the current account nonce
   */
  abstract getNonceId(): string

  // this is specific for v2 accounts, hardcoding a false for all else
  shouldIncludeActivatorCall(broadcastOption: string) {
    return false
  }

  // this is specific for eoa7702 accounts
  shouldSignAuthorization(broadcastOption: string): boolean {
    return false
  }

  // valid only EOAs in very specific circumstances
  shouldBroadcastCallsSeparately(op: AccountOp): boolean {
    return false
  }

  // describe the state override needed during bundler estimation if any
  getBundlerStateOverride(userOp: UserOperation): BundlerStateOverride | undefined {
    return undefined
  }

  // this is specific for v2 accounts
  shouldSignDeployAuth(broadcastOption: string): boolean {
    return false
  }

  isSponsorable(): boolean {
    return false
  }
}
