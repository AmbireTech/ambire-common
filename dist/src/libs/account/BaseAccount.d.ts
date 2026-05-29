import { Account, AccountOnchainState } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { Hex } from '../../interfaces/hex';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { AccountOp } from '../accountOp/accountOp';
import { BundlerStateOverride, FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces';
import { TokenResult } from '../portfolio';
import { UserOperation } from '../userOperation/types';
export declare abstract class BaseAccount {
    protected account: Account;
    protected network: Network;
    protected accountState: AccountOnchainState;
    constructor(account: Account, network: Network, accountState: AccountOnchainState);
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