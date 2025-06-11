import { Account, AccountOnchainState } from '../../interfaces/account';
import { Hex } from '../../interfaces/hex';
import { Network } from '../../interfaces/network';
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
    shouldIncludeActivatorCall(broadcastOption: string): boolean;
    shouldSignAuthorization(broadcastOption: string): boolean;
    shouldBroadcastCallsSeparately(op: AccountOp): boolean;
    getBundlerStateOverride(userOp: UserOperation): BundlerStateOverride | undefined;
    shouldSignDeployAuth(broadcastOption: string): boolean;
    isSponsorable(): boolean;
}
//# sourceMappingURL=BaseAccount.d.ts.map