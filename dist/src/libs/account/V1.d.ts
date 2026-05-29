import { IActivityController } from '../../interfaces/activity';
import { Hex } from '../../interfaces/hex';
import { RPCProvider } from '../../interfaces/provider';
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
    getNonceId(): string;
    getBroadcastNonce(activity: IActivityController, op: AccountOp, provider: RPCProvider): Promise<bigint>;
    /**
     * The Ambire estimation is made to work perfectly with Ambire SA
     */
    shouldStateOverrideDuringSimulations(): boolean;
    canBroadcastByOtherEOA(): boolean;
    canSetCustomGasPrices(): boolean;
    canSetCustomGas(): boolean;
}
//# sourceMappingURL=V1.d.ts.map