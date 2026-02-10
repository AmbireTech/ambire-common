/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { AbiCoder, concat, Interface, ZeroAddress } from 'ethers'

import { execTransactionAbi, multiSendAddr } from '../../consts/safe'
import { IActivityController } from '../../interfaces/activity'
import { Hex } from '../../interfaces/hex'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import { getSigForCalculations } from '../estimate/estimateHelpers'
import {
  BundlerStateOverride,
  FeePaymentOption,
  FullEstimation,
  FullEstimationSummary
} from '../estimate/interfaces'
import { getBroadcastGas } from '../gasPrice/gasPrice'
import { TokenResult } from '../portfolio'
import { isNative } from '../portfolio/helpers'
import { UserOperation } from '../userOperation/types'
import { BaseAccount } from './BaseAccount'

// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class Safe extends BaseAccount {
  /**
   * We state override the safe during estimate with the ambire SA
   * so that we could easily perform estimation. There's about a 15k
   * diff between ambire and safe account gas usage. We add this
   * extra to the gas to make sure txns are passing
   */
  EXTRA_ESTIMATION_GAS = 15000n

  getEstimationCriticalError(estimation: FullEstimation): Error | null {
    if (estimation.ambire instanceof Error) return estimation.ambire
    return null
  }

  supportsBundlerEstimation() {
    return false
  }

  isSponsorable() {
    return false
  }

  getAvailableFeeOptions(
    estimation: FullEstimationSummary,
    feePaymentOptions: FeePaymentOption[]
  ): FeePaymentOption[] {
    return feePaymentOptions.filter((opt) => isNative(opt.token))
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

    const ambireBroaddcastGas = getBroadcastGas(this, options.op)
    return ambireBroaddcastGas + estimation.ambireEstimation.gasUsed + this.EXTRA_ESTIMATION_GAS
  }

  getBroadcastOption(): string {
    return BROADCAST_OPTIONS.byOtherEOA
  }

  canUseReceivingNativeForFee(): boolean {
    return false // because we're always paying with EOA atm
  }

  getBroadcastCalldata(accountOp: AccountOp): Hex {
    const exec = new Interface(execTransactionAbi)
    const calls = getSignableCalls(accountOp)
    const coder = new AbiCoder()
    const multiSendCalls = calls.map((call) => {
      return coder.encode(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [0, call[0], call[1], call[2].length, call[2]]
      )
    })

    // signature cost is equal to the threshold
    let signature = getSigForCalculations()
    for (let i = 1; i < this.accountState.threshold; i++) {
      signature = concat([signature, getSigForCalculations()])
    }

    return exec.encodeFunctionData('execTransaction', [
      multiSendAddr,
      0n,
      concat(multiSendCalls),
      1n, // multiSend only works with delegate call
      0n, // safe, outer gas gets set
      0n, // safe, outer gas gets set
      0n, // safe, outer gas price gets set
      ZeroAddress, // gasToken
      ZeroAddress, // no refunder
      signature
    ]) as Hex
  }

  getBundlerStateOverride(userOp: UserOperation): BundlerStateOverride | undefined {
    return undefined
  }

  // should we authorize the entry point;
  // since we're not using 4337 for Safe accounts for now, we keep it false
  shouldSignDeployAuth(broadcastOption: string): boolean {
    return false
  }

  getAtomicStatus(): 'unsupported' | 'supported' | 'ready' {
    return 'supported'
  }

  getNonceId(): string {
    // the safe will move only its own smart account nonce as we don't have 4337
    return `${this.accountState.nonce.toString()}`
  }

  canBroadcastByItself(): boolean {
    // later, when we enable 4337:
    // check the account version and enable this for versions > 1.3
    return false
  }

  async getBroadcastNonce(
    activity: IActivityController,
    op: AccountOp,
    provider: RPCProvider
  ): Promise<bigint> {
    // the safe account nonce
    return op.nonce as bigint
  }

  /**
   * We state override safes as the ambire estimation is working
   * with Ambire smart accounts
   */
  shouldStateOverrideDuringSimulations(): boolean {
    return true
  }

  canBroadcastByOtherEOA(): boolean {
    return true
  }
}
