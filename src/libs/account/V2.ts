/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interface, ZeroAddress } from 'ethers'
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import { Hex } from '../../interfaces/hex'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import { FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces'
import { getBroadcastGas } from '../gasPrice/gasPrice'
import { TokenResult } from '../portfolio'
import { BaseAccount } from './BaseAccount'
import { getSpoof } from './account'

// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class V2 extends BaseAccount {
  getEstimationCriticalError(estimation: FullEstimation): Error | null {
    if (estimation.ambire instanceof Error) return estimation.ambire
    return null
  }

  supportsBundlerEstimation() {
    return this.network.erc4337.enabled
  }

  getAvailableFeeOptions(
    estimation: FullEstimationSummary,
    feePaymentOptions: FeePaymentOption[]
  ): FeePaymentOption[] {
    const isNative = (token: TokenResult) => token.address === ZeroAddress && !token.flags.onGasTank
    const hasPaymaster =
      this.network.erc4337.enabled &&
      estimation.bundlerEstimation &&
      estimation.bundlerEstimation.paymaster.isUsable()

    // on a 4437 network where the account is not deployed,
    // we force the user to pay by ERC-4337 to enable the entry point
    if (this.network.erc4337.enabled && !this.accountState.isDeployed) {
      return feePaymentOptions.filter(
        (opt) =>
          opt.availableAmount > 0n &&
          opt.paidBy === this.account.addr &&
          (isNative(opt.token) || hasPaymaster)
      )
    }

    const hasRelayer = !this.network.erc4337.enabled && this.network.hasRelayer
    return feePaymentOptions.filter(
      (opt) => opt.availableAmount > 0n && (isNative(opt.token) || hasPaymaster || hasRelayer)
    )
  }

  getGasUsed(
    estimation: FullEstimationSummary,
    options: {
      feeToken: TokenResult
      op: AccountOp
    }
  ): bigint {
    if (estimation.error || !estimation.ambireEstimation) return 0n

    const ambireBroaddcastGas = getBroadcastGas(this, options.op)
    const ambireGas = ambireBroaddcastGas + estimation.ambireEstimation.gasUsed

    // no 4337 => use ambireEstimation
    if (!this.network.erc4337.enabled) return ambireGas

    // has 4337 => use the bundler if it doesn't have an error
    if (!estimation.bundlerEstimation) return ambireGas
    const bundlerGasUsed = BigInt(estimation.bundlerEstimation.callGasLimit)
    return bundlerGasUsed > ambireGas ? bundlerGasUsed : ambireGas
  }

  getBroadcastOption(
    feeOption: FeePaymentOption,
    options: {
      op: AccountOp
    }
  ): string {
    if (feeOption.paidBy !== this.getAccount().addr) return BROADCAST_OPTIONS.byOtherEOA
    if (this.network.erc4337.enabled) return BROADCAST_OPTIONS.byBundler
    return BROADCAST_OPTIONS.byRelayer
  }

  shouldIncludeActivatorCall(broadcastOption: string) {
    return (
      this.network.erc4337.enabled &&
      !this.accountState.isErc4337Enabled &&
      broadcastOption === BROADCAST_OPTIONS.byOtherEOA
    )
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
}
