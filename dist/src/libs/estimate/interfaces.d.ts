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
export interface Erc4337GasLimits {
    preVerificationGas: string;
    verificationGasLimit: string;
    callGasLimit: string;
    paymasterVerificationGasLimit: string;
    paymasterPostOpGasLimit: string;
    gasPrice: GasSpeeds;
    paymaster: AbstractPaymaster;
}
export interface FeePaymentOption {
    availableAmount: bigint;
    paidBy: string;
    gasUsed?: bigint;
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
//# sourceMappingURL=interfaces.d.ts.map