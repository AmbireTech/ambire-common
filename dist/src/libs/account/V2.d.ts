import { IActivityController } from '../../interfaces/activity';
import { Hex } from '../../interfaces/hex';
import { RPCProvider } from '../../interfaces/provider';
import { AccountOp } from '../accountOp/accountOp';
import { BundlerStateOverride, FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces';
import { TokenResult } from '../portfolio';
import { UserOperation } from '../userOperation/types';
import { BaseAccount } from './BaseAccount';
export declare class V2 extends BaseAccount {
    #private;
    ENTRY_POINT_DEPLOYMENT_ADDITIONAL_GAS: bigint;
    getEstimationCriticalError(estimation: FullEstimation): Error | null;
    supportsBundlerEstimation(): boolean;
    getAvailableFeeOptions(estimation: FullEstimationSummary, feePaymentOptions: FeePaymentOption[], op: AccountOp): FeePaymentOption[];
    getGasUsed(estimation: FullEstimationSummary | Error, options: {
        feeToken: TokenResult;
        op: AccountOp;
    }): bigint;
    getBroadcastOption(feeOption: FeePaymentOption, options: {
        op: AccountOp;
    }): string;
    shouldIncludeActivatorCall(paidBy?: string): boolean;
    canUseReceivingNativeForFee(): boolean;
    getBroadcastCalldata(accountOp: AccountOp): Hex;
    getBundlerStateOverride(userOp: UserOperation): BundlerStateOverride | undefined;
    shouldSignDeployAuth(broadcastOption: string): boolean;
    isSponsorable(): boolean;
    getAtomicStatus(): 'unsupported' | 'supported' | 'ready';
    getNonceId(): string;
    getBroadcastNonce(activity: IActivityController, op: AccountOp, provider: RPCProvider): Promise<bigint>;
    /**
     * The Ambire estimation is made to work perfectly with Ambire SA
     */
    shouldStateOverrideDuringSimulations(): boolean;
    canBroadcastByOtherEOA(): boolean;
    canSetCustomGasPrices(feeOption: FeePaymentOption): boolean;
    canSetCustomGas(feeOption: FeePaymentOption): boolean;
}
//# sourceMappingURL=V2.d.ts.map