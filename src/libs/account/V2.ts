/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interface } from 'ethers'
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import { ENTRY_POINT_MARKER, ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Hex } from '../../interfaces/hex'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import {
  BundlerStateOverride,
  FeePaymentOption,
  FullEstimation,
  FullEstimationSummary
} from '../estimate/interfaces'
import { getBroadcastGas } from '../gasPrice/gasPrice'
import { TokenResult } from '../portfolio'
import { isNative } from '../portfolio/helpers'
import { privSlot } from '../proxyDeploy/deploy'
import { UserOperation } from '../userOperation/types'
import { BaseAccount } from './BaseAccount'
import { getSpoof } from './account'

// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class V2 extends BaseAccount {
  // we're state overriding the estimation to make it think
  // the account is deployed and it has the entry point as a signer
  //
  // deployment costs are already added and calculated by the ambire estimation
  // we're adding 20k gas for SSTORE in the privilege for the entry point
  // and 15k gas entry point overhead to be on the safe side
  ENTRY_POINT_DEPLOYMENT_ADDITIONAL_GAS = 35000n

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
    const hasPaymaster =
      this.network.erc4337.enabled &&
      estimation.bundlerEstimation &&
      estimation.bundlerEstimation.paymaster.isUsable()

    // on a 4437 network where the account is not deployed,
    // we force the user to pay by ERC-4337 to enable the entry point
    if (this.network.erc4337.enabled && !this.accountState.isDeployed) {
      return feePaymentOptions.filter(
        (opt) =>
          opt.paidBy === this.account.addr &&
          (isNative(opt.token) || (opt.availableAmount > 0n && hasPaymaster))
      )
    }

    const hasRelayer = !this.network.erc4337.enabled && this.network.hasRelayer
    return feePaymentOptions.filter(
      (opt) =>
        // always show account native, even if not enough
        (isNative(opt.token) && opt.paidBy === this.account.addr) ||
        // show EOA native only if it has amount to pay the fee
        (isNative(opt.token) && opt.availableAmount > 0n) ||
        (opt.availableAmount > 0n && (hasPaymaster || hasRelayer))
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
    const ambireGas = ambireBroaddcastGas + estimation.ambireEstimation.gasUsed

    // no 4337 => use ambireEstimation
    if (!this.network.erc4337.enabled) return ambireGas

    // has 4337 => use the bundler if it doesn't have an error
    if (!estimation.bundlerEstimation) return ambireGas
    let bundlerGasUsed = BigInt(estimation.bundlerEstimation.callGasLimit)

    // if the account is not deployed, add the ambire estimation deployment calc
    // to the bundler total as we're state overriding the bundler to think
    // the account is already deployed during estimation
    if (!this.accountState.isDeployed)
      bundlerGasUsed +=
        estimation.ambireEstimation.deploymentGas + this.ENTRY_POINT_DEPLOYMENT_ADDITIONAL_GAS

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

  getBundlerStateOverride(userOp: UserOperation): BundlerStateOverride | undefined {
    if (this.accountState.isDeployed || !!userOp.factory) return undefined

    return {
      [this.account.addr]: {
        code: AmbireAccount.binRuntime,
        stateDiff: {
          [privSlot(0, 'uint256', ERC_4337_ENTRYPOINT, 'uint256')]: ENTRY_POINT_MARKER
        }
      }
    }
  }

  // we need to authorize the entry point as a signer if we're deploying
  // the account via 4337
  shouldSignDeployAuth(broadcastOption: string): boolean {
    return broadcastOption === BROADCAST_OPTIONS.byBundler && !this.accountState.isDeployed
  }

  isSponsorable(): boolean {
    return this.network.chainId === 100n
  }

  getAtomicStatus(): 'unsupported' | 'supported' | 'ready' {
    return 'supported'
  }

  getNonceId(): string {
    // v2 accounts have two nonces: ambire smart account & entry point nonce
    return `${this.accountState.nonce.toString()}-${this.accountState.erc4337Nonce.toString()}`
  }
}
