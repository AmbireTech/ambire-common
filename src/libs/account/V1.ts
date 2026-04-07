/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interface, ZeroAddress } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import { ARBITRUM_CHAIN_ID } from '../../consts/networks'
import { IActivityController } from '../../interfaces/activity'
import { Hex } from '../../interfaces/hex'
import { RPCProvider } from '../../interfaces/provider'
import { getRelayerNonce } from '../../utils/nonce'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import { FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces'
import { getBroadcastGas } from '../gasPrice/gasPrice'
import { TokenResult } from '../portfolio'
import { getSpoof } from './account'
import { BaseAccount } from './BaseAccount'

// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class V1 extends BaseAccount {
  getEstimationCriticalError(estimation: FullEstimation): Error | null {
    if (estimation.ambire instanceof Error) return estimation.ambire
    return null
  }

  supportsBundlerEstimation() {
    return false
  }

  getAvailableFeeOptions(
    estimation: FullEstimationSummary,
    feePaymentOptions: FeePaymentOption[]
  ): FeePaymentOption[] {
    const options = feePaymentOptions.filter(
      (opt) => opt.paidBy !== this.account.addr && opt.availableAmount > 0n
    )
    if (options.length) return options

    // return the native only to display errors
    const native = feePaymentOptions.find(
      (opt) =>
        opt.paidBy === this.account.addr &&
        opt.token.address === ZeroAddress &&
        !opt.token.flags.onGasTank
    )
    if (!native) throw new Error('no native fee payment option, it should not happen')
    native.availableAmount = 0n
    return [native]
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
    const providerGasUsed = estimation.providerEstimation
      ? estimation.providerEstimation.gasUsed
      : 0n

    const ambireBroaddcastGas = getBroadcastGas(this, options.op)
    const ambireGas = ambireBroaddcastGas + estimation.ambireEstimation.gasUsed

    // use ambireEstimation.gasUsed in all cases except Arbitrum when
    // the provider gas is more than the ambire gas
    return this.network.chainId === ARBITRUM_CHAIN_ID && providerGasUsed > ambireGas
      ? providerGasUsed
      : ambireGas
  }

  getBroadcastOption(
    feeOption: FeePaymentOption,
    options: {
      op: AccountOp
    }
  ): string {
    if (feeOption.paidBy !== this.getAccount().addr) return BROADCAST_OPTIONS.byOtherEOA
    return BROADCAST_OPTIONS.byRelayer
  }

  canUseReceivingNativeForFee(): boolean {
    return true
  }

  getBroadcastCalldata(accountOp: AccountOp): Hex {
    if (this.accountState.isDeployed) {
      const ambireAccount = new Interface(AmbireAccount.abi)
      return ambireAccount.encodeFunctionData('executeBySender', [
        getSignableCalls(accountOp)
      ]) as Hex
    }

    // deployAndExecuteMultiple is the worst case
    const ambireFactory = new Interface(AmbireFactory.abi)
    return ambireFactory.encodeFunctionData('deployAndExecute', [
      this.account.creation!.bytecode,
      this.account.creation!.salt,
      getSignableCalls(accountOp),
      getSpoof(this.account)
    ]) as Hex
  }

  getAtomicStatus(): 'unsupported' | 'supported' | 'ready' {
    return 'supported'
  }

  getNonceId(): string {
    // v1 accounts can only have an ambire smart contract nonce
    return this.accountState.nonce.toString()
  }

  async getBroadcastNonce(
    activity: IActivityController,
    op: AccountOp,
    provider: RPCProvider
  ): Promise<bigint> {
    return getRelayerNonce(activity, op, provider)
  }

  /**
   * The Ambire estimation is made to work perfectly with Ambire SA
   */
  shouldStateOverrideDuringSimulations(): boolean {
    return false
  }

  canBroadcastByOtherEOA(): boolean {
    return true
  }
}
