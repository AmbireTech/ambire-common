/* eslint-disable class-methods-use-this */
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { FeePaymentOption, FullEstimationSummary } from '../estimate/interfaces'
import { TokenResult } from '../portfolio'
import { BaseAccount } from './BaseAccount'

// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class V1 extends BaseAccount {
  getAvailableFeeOptions(feePaymentOptions: FeePaymentOption[]): FeePaymentOption[] {
    return feePaymentOptions.filter((opt) => opt.availableAmount > 0n)
  }

  getGasUsed(
    estimation: FullEstimationSummary,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options: {
      feeToken: TokenResult
      network: Network
      op: AccountOp
      accountState: AccountOnchainState
    }
  ): bigint {
    if (estimation.error || !estimation.ambireEstimation) return 0n
    return estimation.ambireEstimation.gasUsed
  }
}
