/* eslint-disable class-methods-use-this */
import { Interface, ZeroAddress } from 'ethers'
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccount7702 from '../../../contracts/compiled/AmbireAccount7702.json'
import { Hex } from '../../interfaces/hex'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import {
  BundlerStateOverride,
  FeePaymentOption,
  FullEstimation,
  FullEstimationSummary
} from '../estimate/interfaces'
import { getBroadcastGas } from '../gasPrice/gasPrice'
import { TokenResult } from '../portfolio'
import { UserOperation } from '../userOperation/types'
import { BaseAccount } from './BaseAccount'

// this class describes an EOA that CAN transition to 7702
// even if it is YET to transition to 7702
export class EOA7702 extends BaseAccount {
  // when doing the 7702 activator, we should add the additional gas required
  // for the authorization list:
  // PER_EMPTY_ACCOUNT_COST: 25000
  // access list storage key: 1900
  // access list address: 2400
  ACTIVATOR_GAS_USED = 29300n

  getEstimationCriticalError(estimation: FullEstimation): Error | null {
    if (estimation.ambire instanceof Error) return estimation.ambire
    return null
  }

  supportsBundlerEstimation() {
    return true
  }

  /*
   * Available options:
   * - Native
   * - Token/Gas tank, if bundler estimation & paymaster
   */
  getAvailableFeeOptions(
    estimation: FullEstimationSummary,
    feePaymentOptions: FeePaymentOption[]
  ): FeePaymentOption[] {
    const isNative = (token: TokenResult) => token.address === ZeroAddress && !token.flags.onGasTank
    return feePaymentOptions.filter(
      (opt) =>
        opt.paidBy === this.account.addr &&
        opt.availableAmount > 0n &&
        (isNative(opt.token) ||
          (estimation.bundlerEstimation && estimation.bundlerEstimation.paymaster.isUsable()))
    )
  }

  getGasUsed(
    estimation: FullEstimationSummary | Error,
    options: {
      feeToken: TokenResult
      op: AccountOp
    }
  ): bigint {
    const isError = estimation instanceof Error
    if (isError || !estimation.ambireEstimation) return 0n

    const isNative = options.feeToken.address === ZeroAddress && !options.feeToken.flags.onGasTank
    if (isNative) {
      if (this.accountState.isSmarterEoa) {
        // paying in native + smartEOA makes the provider estimation more accurate
        if (estimation.providerEstimation) return estimation.providerEstimation.gasUsed

        // trust the ambire estimaton as it's more precise
        // but also add the broadcast gas as it's not included in the ambire estimate
        return estimation.ambireEstimation.gasUsed + getBroadcastGas(this, options.op)
      }

      // if calls are only 1, use the provider if set
      const numberOfCalls = options.op.calls.length
      if (numberOfCalls === 1) {
        return estimation.providerEstimation
          ? estimation.providerEstimation.gasUsed
          : estimation.ambireEstimation.gasUsed
      }

      // txn type 4 from here: not smarter with a batch, we need the bundler
      if (!estimation.bundlerEstimation) return 0n
      return BigInt(estimation.bundlerEstimation.callGasLimit) + this.ACTIVATOR_GAS_USED
    }

    // if we're paying in tokens, we're using the bundler
    if (!estimation.bundlerEstimation) return 0n

    return this.accountState.isSmarterEoa
      ? BigInt(estimation.bundlerEstimation.callGasLimit)
      : BigInt(estimation.bundlerEstimation.callGasLimit) + this.ACTIVATOR_GAS_USED
  }

  getBroadcastOption(
    feeOption: FeePaymentOption,
    options: {
      op: AccountOp
    }
  ): string {
    const feeToken = feeOption.token
    const isNative = feeToken.address === ZeroAddress && !feeToken.flags.onGasTank
    if (isNative) {
      // if the call is only 1, broadcast normally
      if (options.op.calls.length === 1) return BROADCAST_OPTIONS.bySelf

      // if already smart, executeBySender() on itself
      if (this.accountState.isSmarterEoa) return BROADCAST_OPTIONS.bySelf7702
    }

    // txn type 4 OR paying in token
    return BROADCAST_OPTIONS.byBundler
  }

  // if the EOA is not yet smarter and the broadcast option is a bundler,
  // sign the authorization
  shouldSignAuthorization(broadcastOption: string): boolean {
    return !this.accountState.isSmarterEoa && broadcastOption === BROADCAST_OPTIONS.byBundler
  }

  canUseReceivingNativeForFee(): boolean {
    return false
  }

  getBroadcastCalldata(accountOp: AccountOp): Hex {
    const ambireAccount = new Interface(AmbireAccount.abi)
    return ambireAccount.encodeFunctionData('executeBySender', [getSignableCalls(accountOp)]) as Hex
  }

  getBundlerStateOverride(userOp: UserOperation): BundlerStateOverride | undefined {
    if (this.accountState.isSmarterEoa || !!userOp.eip7702Auth) return undefined

    // if EOA without eip7702Auth, make it look like a smart account so we could
    // do the estimation
    return {
      [this.account.addr]: {
        code: AmbireAccount7702.binRuntime
      }
    }
  }
}
