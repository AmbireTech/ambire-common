/* eslint-disable class-methods-use-this */
import { ARBITRUM_CHAIN_ID } from 'consts/networks'
import { ZeroAddress } from 'ethers'
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { FeePaymentOption, FullEstimationSummary } from '../estimate/interfaces'
import { TokenResult } from '../portfolio'
import { BaseAccount } from './BaseAccount'

// this class describes an EOA that CAN transition to 7702
// even if it is YET to transition to 7702
export class EOA7702 extends BaseAccount {
  getAvailableFeeOptions(feePaymentOptions: FeePaymentOption[]): FeePaymentOption[] {
    return feePaymentOptions.filter(
      (opt) => opt.paidBy === this.account.addr && opt.availableAmount > 0n
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
}
