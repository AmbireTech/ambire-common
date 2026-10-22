import { EIP7702Auth } from '../../consts/7702';
import { BUNDLER } from '../../consts/bundlers';
import { Hex } from '../../interfaces/hex';
import { Call } from '../accountOp/types';
export interface PackedUserOperation {
    sender: string;
    nonce: bigint;
    initCode: Hex;
    callData: Hex;
    accountGasLimits: Hex;
    preVerificationGas: bigint;
    gasFees: Hex;
    paymasterAndData: Hex;
    signature?: Hex;
}
export interface UserOperation {
    sender: string;
    nonce: string;
    factory?: string;
    factoryData?: string;
    callData: string;
    callGasLimit: string;
    verificationGasLimit: string;
    preVerificationGas: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    paymaster?: string;
    paymasterVerificationGasLimit?: string;
    paymasterPostOpGasLimit?: string;
    paymasterData?: string;
    signature: string;
    activatorCall?: Call;
    bundler: BUNDLER;
    eip7702Auth?: EIP7702Auth;
}
/** The userOp fields that make up its packed form, so a userOp from elsewhere can be packed. */
export type PackableUserOperation = Pick<UserOperation, 'sender' | 'nonce' | 'factory' | 'factoryData' | 'callData' | 'callGasLimit' | 'verificationGasLimit' | 'preVerificationGas' | 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'paymaster' | 'paymasterVerificationGasLimit' | 'paymasterPostOpGasLimit' | 'paymasterData'>;
export interface UserOperationEventData {
    nonce: number;
    success: boolean;
}
//# sourceMappingURL=types.d.ts.map