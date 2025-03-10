/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { ARBITRUM_CHAIN_ID } from '../../consts/networks'
import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import { FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces'
import { TokenResult } from '../portfolio'
import { BaseAccount } from './BaseAccount'

// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class V1 extends BaseAccount {
  getEstimationCriticalError(estimation: FullEstimation): Error | null {
    if (estimation.ambire instanceof Error) return estimation.ambire
    return null
  }

  getAvailableFeeOptions(
    estimation: FullEstimationSummary,
    network: Network,
    feePaymentOptions: FeePaymentOption[]
  ): FeePaymentOption[] {
    return feePaymentOptions.filter((opt) => opt.availableAmount > 0n)
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
    const providerGasUsed = estimation.providerEstimation
      ? estimation.providerEstimation.gasUsed
      : 0n
    // use ambireEstimation.gasUsed in all cases except Arbitrum when
    // the provider gas is more than the ambire gas
    return options.network.chainId === ARBITRUM_CHAIN_ID &&
      providerGasUsed > estimation.ambireEstimation.gasUsed
      ? providerGasUsed
      : estimation.ambireEstimation.gasUsed
  }

  getBroadcastOption(
    feeOption: FeePaymentOption,
    options: {
      network: Network
      op: AccountOp
      accountState: AccountOnchainState
    }
  ): string {
    if (feeOption.paidBy !== this.getAccount().addr) return BROADCAST_OPTIONS.byOtherEOA
    return BROADCAST_OPTIONS.byRelayer
  }
}
