import { Log } from 'ethers';
import { EIP7702Auth } from '../../consts/7702';
import { BUNDLER } from '../../consts/bundlers';
import { Account, AccountId, AccountOnchainState } from '../../interfaces/account';
import { AccountOp } from '../accountOp/accountOp';
import { PackedUserOperation, UserOperation, UserOperationEventData } from './types';
export declare function calculateCallDataCost(callData: string): bigint;
export declare function getPaymasterSpoof(): string;
export declare function getActivatorCall(addr: AccountId): {
    to: string;
    value: bigint;
    data: string;
};
/**
 * When we use abi.encode or send the user operation to the bundler,
 * we need to strip it of the specific ambire-common properties that we use
 *
 * @param UserOperation userOp
 * @returns EntryPoint userOp
 */
export declare function getCleanUserOp(userOp: UserOperation): {
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
    eip7702Auth?: EIP7702Auth;
}[];
/**
 * Get the nonce we're expecting in validateUserOp
 * when we're going through the activation | recovery
 *
 * @param UserOperation userOperation
 * @returns hex string
 */
export declare function getOneTimeNonce(userOperation: UserOperation): string;
export declare function getUserOperation({ account, accountState, accountOp, bundler, entryPointSig, eip7702Auth, hasPendingUserOp }: {
    account: Account;
    accountState: AccountOnchainState;
    accountOp: AccountOp;
    bundler: BUNDLER;
    entryPointSig?: string;
    eip7702Auth?: EIP7702Auth;
    hasPendingUserOp?: boolean;
}): UserOperation;
export declare const ENTRY_POINT_AUTHORIZATION_REQUEST_ID = "ENTRY_POINT_AUTHORIZATION_REQUEST_ID";
export declare function getPackedUserOp(userOp: UserOperation): PackedUserOperation;
export declare function getUserOpHash(userOp: UserOperation, chainId: bigint): string;
export declare const parseLogs: (logs: readonly Log[], userOpHash: string, userOpsLength?: number) => UserOperationEventData | null;
/**
 * Get all the bundler statuses that indicate that an userOp
 * is either pending to be mined or successfully included in the blockchain
 */
export declare function getUserOpPendingOrSuccessStatuses(): string[];
//# sourceMappingURL=userOperation.d.ts.map