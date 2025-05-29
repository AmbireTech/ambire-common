import { Hex } from '../../interfaces/hex';
import { AccountOp } from '../accountOp/accountOp';
import { FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces';
import { TokenResult } from '../portfolio';
import { BaseAccount } from './BaseAccount';
export declare class V1 extends BaseAccount {
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
    canUseReceivingNativeForFee(): boolean;
    getBroadcastCalldata(accountOp: AccountOp): Hex;
    getAtomicStatus(): 'unsupported' | 'supported' | 'ready';
}
//# sourceMappingURL=V1.d.ts.map