import { Account, AccountOnchainState } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { Hex } from '../../interfaces/hex';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { AccountOp } from '../accountOp/accountOp';
import { BundlerStateOverride, FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces';
import { TokenResult } from '../portfolio';
import { UserOperation } from '../userOperation/types';
/**
 * Which gas prices the gasPrice controller should fetch for an account:
 * - `bundlerWithRpcFallback`: a single collection from the bundler, falling back to the RPC
 * - `rpc`: a single collection from the RPC only
 * - `rpcWithBundlerFallback`: the RPC gas prices, falling back to the bundler ones if the
 *   RPC fails, used for broadcasts outside the bundler. Bundler broadcasts keep using the
 *   gas prices that come with the bundler estimation
 */
export type GasPriceFetchStrategy = 'bundlerWithRpcFallback' | 'rpc' | 'rpcWithBundlerFallback';
export declare abstract class BaseAccount {
    protected account: Account;
    protected network: Network;
    protected accountState: AccountOnchainState;
    protected isErc4337Enabled: boolean;
    ACTIVATOR_GAS_USED: bigint;
    constructor(account: Account, network: Network, accountState: AccountOnchainState, isErc4337Enabled: boolean);
    getAccount(): Account;
    abstract getEstimationCriticalError(estimation: FullEstimation, op: AccountOp): Error | null;
    abstract supportsBundlerEstimation(): boolean;
    abstract getAvailableFeeOptions(estimation: FullEstimationSummary, feePaymentOptions: FeePaymentOption[], op: AccountOp): FeePaymentOption[];
    abstract getGasUsed(estimation: FullEstimationSummary | Error, options: {
        feeToken: TokenResult;
        op: AccountOp;
    }): bigint;
    abstract getBroadcastOption(feeOption: FeePaymentOption, options: {
        op: AccountOp;
        isSponsored?: boolean;
    }): string;
    abstract canUseReceivingNativeForFee(amount: bigint): boolean;
    abstract getBroadcastCalldata(accountOp: AccountOp): Hex;
    abstract getAtomicStatus(): 'unsupported' | 'supported' | 'ready';
    /**
     * Get a unique identifier of the current account nonce
     */
    abstract getNonceId(): string;
    abstract shouldStateOverrideDuringSimulations(): boolean;
    abstract canBroadcastByOtherEOA(): boolean;
    abstract canSetCustomGasPrices(feeOption: FeePaymentOption): boolean;
    abstract canSetCustomGas(feeOption: FeePaymentOption, accountOp?: AccountOp): boolean;
    shouldIncludeActivatorCall(paidBy?: string): boolean;
    shouldSignAuthorization(broadcastOption: string): boolean;
    shouldBroadcastCallsSeparately(op: AccountOp): boolean;
    getBundlerStateOverride(userOp: UserOperation): BundlerStateOverride | undefined;
    shouldSignDeployAuth(broadcastOption: string): boolean;
    isSponsorable(): boolean;
    canUseErc4337(): boolean;
    /**
     * When ERC-4337 is disabled, the RPC is the only source of gas prices.
     * On Ethereum, the gas prices returned by the bundlers differ from the RPC ones,
     * so the RPC is given priority: accounts that cannot use ERC-4337 rely on the RPC
     * only, while the ones that can use the RPC with the bundler as a fallback for
     * their broadcasts outside the bundler (see shouldUseRpcGasPrices).
     * Everywhere else, the bundler is preferred as it's faster and more accurate
     */
    getGasPriceFetchStrategy(isErc4337Enabled: boolean): GasPriceFetchStrategy;
    /**
     * When the account uses the `rpcWithBundlerFallback` strategy (see getGasPriceFetchStrategy),
     * a bundler broadcast (the account itself paying in a token or native via userOp)
     * should use the bundler gas prices and every other broadcast (by self,
     * by another EOA, by the relayer) - the RPC ones
     */
    shouldUseRpcGasPrices(broadcastOption: string): boolean;
    /**
     * Do we allow the account to broadcast by itself
     */
    canBroadcastByItself(): boolean;
    /**
     * Get the broadcast nonce for each account if special conditions
     * for its fetch should apply
     */
    getBroadcastNonce(activity: IActivityController, op: AccountOp, provider: RPCProvider): Promise<bigint>;
}
//# sourceMappingURL=BaseAccount.d.ts.map