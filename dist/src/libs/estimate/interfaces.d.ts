import { Hex } from '../../interfaces/hex';
import { GasSpeeds } from '../../services/bundlers/types';
import { AbstractPaymaster } from '../paymaster/abstractPaymaster';
import { TokenResult } from '../portfolio';
export interface BundlerEstimateResult {
    preVerificationGas: Hex;
    verificationGasLimit: Hex;
    callGasLimit: Hex;
    paymasterVerificationGasLimit: Hex;
    paymasterPostOpGasLimit: Hex;
}
export interface BundlerStateOverride {
    [accAddr: string]: {
        code: string;
        stateDiff?: {
            [key: string]: string;
        };
    };
}
export interface EstimationFlags {
    hasNonceDiscrepancy?: boolean;
    has4337NonceDiscrepancy?: boolean;
}
export interface Erc4337GasLimits {
    callGasLimit: string;
    preVerificationGas: string;
    verificationGasLimit: string;
    paymasterVerificationGasLimit: string;
    paymasterPostOpGasLimit: string;
    gasPrice: GasSpeeds;
    paymaster: AbstractPaymaster;
    flags: EstimationFlags;
    feeCallType?: string;
    nonFatalErrors?: Error[];
}
export interface FeePaymentOption {
    availableAmount: bigint;
    paidBy: string;
    gasUsed: bigint;
    addedNative: bigint;
    token: TokenResult;
}
export interface EstimateResult {
    gasUsed: bigint;
    currentAccountNonce: number;
    feePaymentOptions: FeePaymentOption[];
    erc4337GasLimits?: Erc4337GasLimits;
    error: Error | null;
    nonFatalErrors?: Error[];
}
export interface ProviderEstimation {
    gasUsed: bigint;
    feePaymentOptions: FeePaymentOption[];
}
export interface AmbireEstimation {
    gasUsed: bigint;
    deploymentGas: bigint;
    feePaymentOptions: FeePaymentOption[];
    ambireAccountNonce: number;
    flags: EstimationFlags;
}
export interface PerCallEstimation {
    gasUsed: bigint;
    gasUsedPerCall: bigint[];
}
export interface FullEstimation {
    provider: ProviderEstimation | Error | null;
    ambire: AmbireEstimation | Error;
    bundler: Erc4337GasLimits | Error | null;
    flags: EstimationFlags;
}
export interface FullEstimationSummary {
    providerEstimation?: ProviderEstimation;
    ambireEstimation?: AmbireEstimation;
    bundlerEstimation?: Erc4337GasLimits;
    flags: EstimationFlags;
}
//# sourceMappingURL=interfaces.d.ts.map