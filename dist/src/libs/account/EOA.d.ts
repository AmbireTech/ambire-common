import { Hex } from '../../interfaces/hex';
import { AccountOp } from '../accountOp/accountOp';
import { AmbireEstimation, FeePaymentOption, FullEstimation, FullEstimationSummary, ProviderEstimation } from '../estimate/interfaces';
import { TokenResult } from '../portfolio';
import { BaseAccount } from './BaseAccount';
export declare class EOA extends BaseAccount {
    providerEstimation?: ProviderEstimation;
    ambireEstimation?: AmbireEstimation | Error;
    getEstimationCriticalError(estimation: FullEstimation, op: AccountOp): Error | null;
    supportsBundlerEstimation(): boolean;
    getAvailableFeeOptions(estimation: FullEstimationSummary, feePaymentOptions: FeePaymentOption[]): FeePaymentOption[];
    getGasUsed(estimation: FullEstimationSummary | Error, options: {
        feeToken: TokenResult;
        op: AccountOp;
    }): bigint;
    getBroadcastOption(feeOption: FeePaymentOption, options: {
        op: AccountOp;
    }): string;
    shouldBroadcastCallsSeparately(op: AccountOp): boolean;
    canUseReceivingNativeForFee(): boolean;
    getBroadcastCalldata(): Hex;
    getAtomicStatus(): 'unsupported' | 'supported' | 'ready';
}
//# sourceMappingURL=EOA.d.ts.map