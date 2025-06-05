import { Hex } from '../../interfaces/hex';
import { AccountOp } from '../accountOp/accountOp';
import { BundlerStateOverride, FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces';
import { TokenResult } from '../portfolio';
import { UserOperation } from '../userOperation/types';
import { BaseAccount } from './BaseAccount';
export declare class V2 extends BaseAccount {
    ENTRY_POINT_DEPLOYMENT_ADDITIONAL_GAS: bigint;
    getEstimationCriticalError(estimation: FullEstimation): Error | null;
    supportsBundlerEstimation(): boolean;
    getAvailableFeeOptions(estimation: FullEstimationSummary, feePaymentOptions: FeePaymentOption[]): FeePaymentOption[];
    getGasUsed(estimation: FullEstimationSummary | Error, options: {
        feeToken: TokenResult;
        op: AccountOp;
    }): bigint;
    getBroadcastOption(feeOption: FeePaymentOption, options: {
        op: AccountOp;
    }): string;
    shouldIncludeActivatorCall(broadcastOption: string): boolean;
    canUseReceivingNativeForFee(): boolean;
    getBroadcastCalldata(accountOp: AccountOp): Hex;
    getBundlerStateOverride(userOp: UserOperation): BundlerStateOverride | undefined;
    shouldSignDeployAuth(broadcastOption: string): boolean;
    isSponsorable(): boolean;
    getAtomicStatus(): 'unsupported' | 'supported' | 'ready';
}
//# sourceMappingURL=V2.d.ts.map