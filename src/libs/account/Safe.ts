/* eslint-disable @typescript-eslint/no-unused-vars */
import { AbiCoder, concat, Interface, ZeroAddress } from 'ethers'

import SafeNoSignatureValidation from '../../../contracts/compiled/SafeNoSignatureValidation.json'
import { execTransactionAbi, multiSendAddr } from '../../consts/safe'
import { IActivityController } from '../../interfaces/activity'
import { Hex } from '../../interfaces/hex'
import { RPCProvider } from '../../interfaces/provider'
import { SafeTx } from '../../interfaces/safe'
import { getSafeTypedData, getSafeV1TypedData } from '../../libs/signMessage/signMessage'
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
import { BaseAccount } from './BaseAccount'

// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class Safe extends BaseAccount {
  /**
   * We state override the Safe during estimate with the ambire SA
   * so that we could easily perform estimation. There's about a 15k
   * diff between ambire and Safe account gas usage. We add this
   * extra to the gas to make sure txns are passing
   */
  EXTRA_ESTIMATION_GAS = 15000n

  /**
   * If the account makes calls to itself (owner/threshold changes),
   * add extra gas per call to self as we're state overriding the estimation
   * and calls to self end up calculate as close to 0 gas
   */
  CALL_TO_SELF_GAS = 40000n

  /**
   * Add 20k additional gas when setting the nonce for the first time
   */
  NONCE_ZERO_GAS = 20000n

  /**
   * Add 5k additional gas for nonce > 0
   */
  NONCE_GAS = 5000n

  /**
   * A one time gas addition if the txn is an userOp.
   * This accounts for the missing signature validation data as we're
   * doing a state override during estimation and replacing the original
   * Safe code with one that allows all signatures to pass
   */
  BUNDLER_OVERHEAD = 40000n

  getEstimationCriticalError(estimation: FullEstimation): Error | null {
    if (estimation.ambire instanceof Error) return estimation.ambire
    return null
  }

  supportsBundlerEstimation() {
    return this.isErc4337Enabled
  }

  isSponsorable() {
    return false
  }

  canUseErc4337(): boolean {
    return true
  }

  getAvailableFeeOptions(
    estimation: FullEstimationSummary,
    feePaymentOptions: FeePaymentOption[]
  ): FeePaymentOption[] {
    const hasPaymaster =
      estimation.bundlerEstimation &&
      estimation.bundlerEstimation.paymaster.isUsable() &&
      // disable the Safe gas tank for megaeth for now as we need a special
      // estimation implementation for it to make it work
      this.network.chainId !== 4326n

    return feePaymentOptions.filter(
      (opt) => isNative(opt.token) || (hasPaymaster && opt.token.flags.onGasTank)
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

    const ambireBroaddcastGas = getBroadcastGas(this, options.op)
    const nonceGas = this.accountState.nonce === 0n ? this.NONCE_ZERO_GAS : this.NONCE_GAS

    // each call to self results in a 0 estimate bcz of state overrides
    let callToSelfGas = 0n
    for (let i = 0; i < options.op.calls.length; i++) {
      const call = options.op.calls[i]!
      if (call.to && call.to.toLowerCase() === this.account.addr.toLowerCase()) {
        callToSelfGas += this.CALL_TO_SELF_GAS
      }
    }

    if (estimation.bundlerEstimation && options.feeToken.flags.onGasTank) {
      return (
        BigInt(estimation.bundlerEstimation.callGasLimit) +
        callToSelfGas +
        this.EXTRA_ESTIMATION_GAS +
        this.BUNDLER_OVERHEAD +
        nonceGas
      )
    }

    return (
      ambireBroaddcastGas +
      estimation.ambireEstimation.gasUsed +
      callToSelfGas +
      this.EXTRA_ESTIMATION_GAS +
      nonceGas
    )
  }

  getBroadcastOption(feeOption: FeePaymentOption): string {
    if (feeOption.paidBy === this.getAccount().addr) return BROADCAST_OPTIONS.byBundler

    return BROADCAST_OPTIONS.byOtherEOA
  }

  canUseReceivingNativeForFee(): boolean {
    return false // because the account cannot pay by itself in native
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

  /**
   * We override the state to an ambire smart account so we could
   * successfully do a bundler estimation. Safe accounts don't have
   * the 4337 module attached so they revert
   */
  getBundlerStateOverride(): BundlerStateOverride | undefined {
    return {
      [this.account.addr]: {
        code: SafeNoSignatureValidation.binRuntime
      }
    }
  }

  // we're not deploying safe accounts
  shouldSignDeployAuth(): boolean {
    return false
  }

  getAtomicStatus(): 'unsupported' | 'supported' | 'ready' {
    return 'supported'
  }

  getNonceId(): string {
    // the Safe will move only its own smart account nonce
    return `${this.accountState.nonce.toString()}`
  }

  canBroadcastByItself(): boolean {
    return true
  }

  async getBroadcastNonce(
    activity: IActivityController,
    op: AccountOp,
    provider: RPCProvider
  ): Promise<bigint> {
    // the Safe account nonce
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

  /**
   * Final commitment Safe data can differ according to the Safe v.
   * We encapsulate the logic here
   */
  getTxnTypedData(safeTx: SafeTx) {
    const safeCreation = this.account.safeCreation!
    if (safeCreation.version.startsWith('1.1.') || safeCreation.version.startsWith('1.2'))
      return getSafeV1TypedData(this.account.addr as Hex, safeTx)

    return getSafeTypedData(this.network.chainId, this.account.addr as Hex, safeTx)
  }

  canSetCustomGasPrices(): boolean {
    return true
  }

  canSetCustomGas(): boolean {
    return this.canSetCustomGasPrices()
  }
}
