/* eslint-disable class-methods-use-this */
import { ZeroAddress } from 'ethers'
import { ARBITRUM_CHAIN_ID } from '../../consts/networks'
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import { FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces'
import { TokenResult } from '../portfolio'
import { BaseAccount } from './BaseAccount'

// this class describes an EOA that CAN transition to 7702
// even if it is YET to transition to 7702
export class EOA7702 extends BaseAccount {
  getEstimationCriticalError(estimation: FullEstimation): Error | null {
    if (estimation.ambire instanceof Error) return estimation.ambire
    return null
  }

  /*
   * Available options:
   * - Native
   * - Token/Gas tank, if bundler estimation & paymaster
   */
  getAvailableFeeOptions(
    estimation: FullEstimationSummary,
    network: Network,
    feePaymentOptions: FeePaymentOption[]
  ): FeePaymentOption[] {
    const isNative = (token: TokenResult) => token.address === ZeroAddress && !token.flags.onGasTank
    return feePaymentOptions.filter(
      (opt) =>
        opt.paidBy === this.account.addr &&
        opt.availableAmount > 0n &&
        (isNative(opt.token) ||
          (estimation.bundlerEstimation && estimation.bundlerEstimation.paymaster))
    )
  }

  getGasUsed(
    estimation: FullEstimationSummary,
    options: {
      feeToken: TokenResult
      network: Network
      op: AccountOp
      accountState: AccountOnchainState
    }
  ): bigint {
    if (estimation.error || !estimation.ambireEstimation) return 0n

    const isNative = options.feeToken.address === ZeroAddress && !options.feeToken.flags.onGasTank
    if (isNative) {
      if (options.accountState.isSmarterEoa) {
        // arbitrum's gasLimit is special as the gasPrice is contained in it as well.
        // that's why it's better to trust the provider's estimation instead of ours
        if (options.network.chainId === ARBITRUM_CHAIN_ID && estimation.providerEstimation)
          return estimation.providerEstimation.gasUsed

        // trust the ambire estimaton as it's more precise
        return estimation.ambireEstimation.gasUsed
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
      return BigInt(estimation.bundlerEstimation.callGasLimit)
    }

    // if we're paying in tokens, we're using the bundler
    if (!estimation.bundlerEstimation) return 0n
    return BigInt(estimation.bundlerEstimation.callGasLimit)
  }

  getBroadcastOption(
    feeOption: FeePaymentOption,
    options: {
      network: Network
      op: AccountOp
      accountState: AccountOnchainState
    }
  ): string {
    const feeToken = feeOption.token
    const isNative = feeToken.address === ZeroAddress && !feeToken.flags.onGasTank
    if (isNative) {
      // if the call is only 1, broadcast normally
      if (options.op.calls.length === 1) return BROADCAST_OPTIONS.bySelf

      // if already smart, executeBySender() on itself
      if (options.accountState.isSmarterEoa) return BROADCAST_OPTIONS.bySelf7702
    }

    // txn type 4 OR paying in token
    return BROADCAST_OPTIONS.byBundler
  }
}
