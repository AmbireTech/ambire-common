import { IActivityController } from '../../interfaces/activity';
import { Hex } from '../../interfaces/hex';
import { RPCProvider } from '../../interfaces/provider';
import { SafeTx } from '../../interfaces/safe';
import { AccountOp } from '../accountOp/accountOp';
import { BundlerStateOverride, FeePaymentOption, FullEstimation, FullEstimationSummary } from '../estimate/interfaces';
import { TokenResult } from '../portfolio';
import { UserOperation } from '../userOperation/types';
import { BaseAccount } from './BaseAccount';
export declare class Safe extends BaseAccount {
    /**
     * We state override the Safe during estimate with the ambire SA
     * so that we could easily perform estimation. There's about a 15k
     * diff between ambire and Safe account gas usage. We add this
     * extra to the gas to make sure txns are passing
     */
    EXTRA_ESTIMATION_GAS: bigint;
    /**
     * If the account makes calls to itself (owner/threshold changes),
     * add extra gas per call to self as we're state overriding the estimation
     * and calls to self end up calculate as close to 0 gas
     */
    CALL_TO_SELF_GAS: bigint;
    /**
     * Add 20k additional gas when setting the nonce for the first time
     */
    NONCE_ZERO_GAS: bigint;
    /**
     * Add 5k additional gas for nonce > 0
     */
    NONCE_GAS: bigint;
    getEstimationCriticalError(estimation: FullEstimation): Error | null;
    supportsBundlerEstimation(): boolean;
    isSponsorable(): boolean;
    getAvailableFeeOptions(estimation: FullEstimationSummary, feePaymentOptions: FeePaymentOption[]): FeePaymentOption[];
    getGasUsed(estimation: FullEstimationSummary | Error, options: {
        feeToken: TokenResult;
        op: AccountOp;
    }): bigint;
    getBroadcastOption(): string;
    canUseReceivingNativeForFee(): boolean;
    getBroadcastCalldata(accountOp: AccountOp): Hex;
    getBundlerStateOverride(userOp: UserOperation): BundlerStateOverride | undefined;
    shouldSignDeployAuth(broadcastOption: string): boolean;
    getAtomicStatus(): 'unsupported' | 'supported' | 'ready';
    getNonceId(): string;
    canBroadcastByItself(): boolean;
    getBroadcastNonce(activity: IActivityController, op: AccountOp, provider: RPCProvider): Promise<bigint>;
    /**
     * We state override safes as the ambire estimation is working
     * with Ambire smart accounts
     */
    shouldStateOverrideDuringSimulations(): boolean;
    canBroadcastByOtherEOA(): boolean;
    /**
     * Final commitment Safe data can differ according to the Safe v.
     * We encapsulate the logic here
     */
    getTxnTypedData(safeTx: SafeTx): {
        domain: import("ethers").TypedDataDomain;
        types: Record<string, Array<import("ethers").TypedDataField>>;
        message: Record<string, any>;
        primaryType: keyof Record<string, Array<import("ethers").TypedDataField>>;
    };
    canSetCustomGasPrices(): boolean;
    canSetCustomGas(): boolean;
}
//# sourceMappingURL=Safe.d.ts.map