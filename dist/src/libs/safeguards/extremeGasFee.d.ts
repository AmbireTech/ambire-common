import { ISignAccountOpController } from '../../interfaces/signAccountOp';
export type ExtremeGasFeeWarningState = {
    type: 'gwei';
    gasPriceGwei: number;
    thresholdGwei: number;
} | {
    type: 'usd';
    feeUsd: number;
    thresholdUsd: number;
};
export declare function weiToGwei(weiValue: bigint): number;
export declare function isExtremeMainnetGasPrice(gasPriceWei: bigint): boolean;
export declare function isExtremeGasFeeUsd(feeUsd: number): boolean;
export declare function getPerOperationFeeUsd(feeUsd: number, callsCount: number): number;
export declare function getExtremeGasFeeWarningState(signAccountOpState: ISignAccountOpController | null, networkChainId: bigint | undefined): ExtremeGasFeeWarningState | null;
//# sourceMappingURL=extremeGasFee.d.ts.map