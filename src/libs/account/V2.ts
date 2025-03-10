/* eslint-disable class-methods-use-this */
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { FeePaymentOption, FullEstimationSummary } from '../estimate/interfaces'
import { BaseAccount } from './BaseAccount'

// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class V2 extends BaseAccount {
  getAvailableFeeOptions(feePaymentOptions: FeePaymentOption[]): FeePaymentOption[] {
    return feePaymentOptions.filter((opt) => opt.availableAmount > 0n)
  }

  getGasUsed(
    estimation: FullEstimationSummary,
    options: {
      feePaymentOption: FeePaymentOption
      network: Network
      op: AccountOp
      accountState: AccountOnchainState
    }
  ): bigint {
    if (estimation.error || !estimation.ambireEstimation) return 0n

    // no 4337 => use ambireEstimation
    if (!options.network.erc4337.enabled) return estimation.ambireEstimation.gasUsed

    // has 4337 => use the bundler if it doesn't have an error
    if (!estimation.bundlerEstimation) return estimation.ambireEstimation.gasUsed
    return BigInt(estimation.bundlerEstimation.callGasLimit)
  }
}
