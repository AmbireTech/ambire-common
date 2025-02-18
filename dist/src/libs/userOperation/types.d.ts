import { BUNDLER } from '../../consts/bundlers';
import { Call } from '../accountOp/types';
export type UserOpRequestType = 'standard' | 'activator' | 'recovery';
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
    requestType: UserOpRequestType;
    activatorCall?: Call;
    bundler: BUNDLER;
}
export interface UserOperationEventData {
    nonce: Number;
    success: boolean;
}
//# sourceMappingURL=types.d.ts.map