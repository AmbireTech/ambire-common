/* eslint-disable class-methods-use-this */
import { ZeroAddress } from 'ethers'
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import {
  AmbireEstimation,
  FeePaymentOption,
  FullEstimationSummary,
  ProviderEstimation
} from '../estimate/interfaces'
import { BaseAccount } from './BaseAccount'

// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class EOA extends BaseAccount {
  providerEstimation?: ProviderEstimation

  ambireEstimation?: AmbireEstimation | Error

  getAvailableFeeOptions(feePaymentOptions: FeePaymentOption[]): FeePaymentOption[] {
    const native = feePaymentOptions.find(
      (opt) =>
        opt.paidBy === this.account.addr &&
        opt.token.address === ZeroAddress &&
        !opt.token.flags.onGasTank
    )
    if (!native) throw new Error('no native fee payment option, it should not happen')
    return [native]
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
    if (estimation.error || !estimation.providerEstimation || !options.op) return 0n

    const calls = options.op.calls
    if (calls.length === 1) {
      const call = calls[0]
      // a normal transfer is 21k, so just return the providerEstimation
      if (call.data === '0x') return estimation.providerEstimation.gasUsed
    }

    const ambireGasUsed = estimation.ambireEstimation ? estimation.ambireEstimation.gasUsed : 0n
    return estimation.providerEstimation.gasUsed > ambireGasUsed
      ? estimation.providerEstimation.gasUsed
      : ambireGasUsed
  }
}
