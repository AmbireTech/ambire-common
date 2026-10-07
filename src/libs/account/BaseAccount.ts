/* eslint-disable @typescript-eslint/no-unused-vars */
import { ETHEREUM_CHAIN_ID } from '../../consts/networks'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOp } from '../accountOp/accountOp'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import {
  BundlerStateOverride,
  FeePaymentOption,
  FullEstimation,
  FullEstimationSummary
} from '../estimate/interfaces'
import { TokenResult } from '../portfolio'
import { UserOperation } from '../userOperation/types'

/**
 * Which gas price collections the gasPrice controller should fetch for an account:
 * - `bundlerWithRpcFallback`: a single collection from the bundler, falling back to the RPC
 * - `rpc`: a single collection from the RPC only
 * - `rpcWithBundlerFallback`: two separate collections, one from the RPC and one from the bundler
 */
export type GasPriceFetchStrategy = 'bundlerWithRpcFallback' | 'rpc' | 'rpcWithBundlerFallback'

export abstract class BaseAccount {
  protected account: Account

  protected network: Network

  protected accountState: AccountOnchainState

  protected isErc4337Enabled: boolean

  // when doing the 7702 activator/revoke, we should add the additional gas required
  // for the authorization list:
  // PER_EMPTY_ACCOUNT_COST: 25000
  // access list storage key: 1900
  // access list address: 2400
  ACTIVATOR_GAS_USED = 29300n

  constructor(
    account: Account,
    network: Network,
    accountState: AccountOnchainState,
    isErc4337Enabled: boolean
  ) {
    this.account = account
    this.network = network
    this.accountState = accountState
    this.isErc4337Enabled = isErc4337Enabled
  }

  getAccount() {
    return this.account
  }

  // each implementation should declare when an estimation failure is critical
  // and we should display it to the user
  abstract getEstimationCriticalError(estimation: FullEstimation, op: AccountOp): Error | null

  abstract supportsBundlerEstimation(): boolean

  abstract getAvailableFeeOptions(
    estimation: FullEstimationSummary,
    feePaymentOptions: FeePaymentOption[],
    op: AccountOp
  ): FeePaymentOption[]

  abstract getGasUsed(
    estimation: FullEstimationSummary | Error,
    // all of the options below need to be passed. Each implementation
    // decides on its own which are actually important for it
    options: {
      feeToken: TokenResult
      op: AccountOp
    }
  ): bigint

  abstract getBroadcastOption(
    feeOption: FeePaymentOption,
    options: {
      op: AccountOp
      isSponsored?: boolean
    }
  ): string

  // can the account type use the receiving amount after the estimation
  // to pay the fee. Smart accounts can but EOA / 7702 EOAs cannot
  // as paying in native means broadcasting as an EOA - you have to
  // have the native before broadcast
  abstract canUseReceivingNativeForFee(amount: bigint): boolean

  // when using the ambire estimation, the broadcast gas is not included
  // so smart accounts that broadacast with EOAs/relayer do not have the
  // additional broadcast gas included
  //
  // Additionally, 7702 EOAs that use the ambire estimation suffer from
  // the same problem as they do broadcast by themselves by only
  // the smart account contract gas is calculated
  //
  // we return the calldata specific for each account to allow
  // the estimation to calculate it correctly
  abstract getBroadcastCalldata(accountOp: AccountOp): Hex

  // each account should declare if it supports atomicity
  abstract getAtomicStatus(): 'unsupported' | 'supported' | 'ready'

  /**
   * Get a unique identifier of the current account nonce
   */
  abstract getNonceId(): string

  abstract shouldStateOverrideDuringSimulations(): boolean

  abstract canBroadcastByOtherEOA(): boolean

  abstract canSetCustomGasPrices(feeOption: FeePaymentOption): boolean

  abstract canSetCustomGas(feeOption: FeePaymentOption, accountOp?: AccountOp): boolean

  // this is specific for v2 accounts, hardcoding a false for all else
  shouldIncludeActivatorCall(paidBy?: string) {
    return false
  }

  // this is specific for eoa7702 accounts
  shouldSignAuthorization(broadcastOption: string): boolean {
    return false
  }

  // valid only EOAs in very specific circumstances
  shouldBroadcastCallsSeparately(op: AccountOp): boolean {
    return false
  }

  // describe the state override needed during bundler estimation if any
  getBundlerStateOverride(userOp: UserOperation): BundlerStateOverride | undefined {
    return undefined
  }

  // this is specific for v2 accounts
  shouldSignDeployAuth(broadcastOption: string): boolean {
    return false
  }

  isSponsorable(): boolean {
    return false
  }

  canUseErc4337(): boolean {
    return false
  }

  /**
   * On Ethereum, the gas prices returned by the bundlers differ from the RPC ones.
   * Accounts that cannot use ERC-4337 rely on the RPC only, while the ones that can
   * receive both collections so each broadcast option could use the correct one.
   * Everywhere else, the bundler is preferred as it's faster and more accurate
   */
  getGasPriceFetchStrategy(isErc4337Enabled: boolean): GasPriceFetchStrategy {
    // global config
    if (!isErc4337Enabled) return 'rpc'

    // bundler is with priority on other chains
    if (this.network.chainId !== ETHEREUM_CHAIN_ID) return 'bundlerWithRpcFallback'

    // rpc is with priority on Ethereum
    return this.canUseErc4337() ? 'rpcWithBundlerFallback' : 'rpc'
  }

  /**
   * When both gas price collections are available (see getGasPriceFetchStrategy),
   * a bundler broadcast (the account itself paying in a token or native via userOp)
   * should use the bundler gas prices and every other broadcast (by self,
   * by another EOA, by the relayer) - the RPC ones
   */
  shouldUseRpcGasPrices(broadcastOption: string): boolean {
    return broadcastOption !== BROADCAST_OPTIONS.byBundler
  }

  /**
   * Do we allow the account to broadcast by itself
   */
  canBroadcastByItself(): boolean {
    return true
  }

  /**
   * Get the broadcast nonce for each account if special conditions
   * for its fetch should apply
   */
  async getBroadcastNonce(
    activity: IActivityController,
    op: AccountOp,
    provider: RPCProvider
  ): Promise<bigint> {
    return op.nonce as bigint
  }
}
