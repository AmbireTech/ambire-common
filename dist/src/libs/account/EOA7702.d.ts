import { Hex } from '../../interfaces/hex';
import { AccountOp } from '../accountOp/accountOp';
import { BundlerStateOverride, FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces';
import { TokenResult } from '../portfolio';
import { UserOperation } from '../userOperation/types';
import { BaseAccount } from './BaseAccount';
export declare class EOA7702 extends BaseAccount {
    ACTIVATOR_GAS_USED: bigint;
    /**
     * Introduce a public variable we can use to make a simple check on the FE
     * whether this account type is 7702.
     * This should only be used in cases where refactoring the logic on the FE
     * would mean a time-consuming event like sorting the fee payment options.
     * Use this as an exception rather than rule. Long term, we should refactor
     */
    is7702: boolean;
    getEstimationCriticalError(estimation: FullEstimation, op: AccountOp): Error | null;
    supportsBundlerEstimation(): boolean;
    getAvailableFeeOptions(estimation: FullEstimationSummary, feePaymentOptions: FeePaymentOption[], op: AccountOp): FeePaymentOption[];
    getGasUsed(estimation: FullEstimationSummary | Error, options: {
        feeToken: TokenResult;
        op: AccountOp;
    }): bigint;
    getBroadcastOption(feeOption: FeePaymentOption, options: {
        op: AccountOp;
        isSponsored?: boolean;
    }): string;
    shouldSignAuthorization(broadcastOption: string): boolean;
    canUseReceivingNativeForFee(amount: bigint): boolean;
    getBroadcastCalldata(accountOp: AccountOp): Hex;
    getBundlerStateOverride(userOp: UserOperation): BundlerStateOverride | undefined;
    isSponsorable(): boolean;
    getAtomicStatus(): 'unsupported' | 'supported' | 'ready';
}
//# sourceMappingURL=EOA7702.d.ts.map