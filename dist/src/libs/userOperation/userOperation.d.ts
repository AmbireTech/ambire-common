import { Log } from 'ethers';
import { Network } from 'interfaces/network';
import { BUNDLER } from '../../consts/bundlers';
import { Account, AccountId, AccountOnchainState } from '../../interfaces/account';
import { AccountOp } from '../accountOp/accountOp';
import { UserOperation, UserOperationEventData, UserOpRequestType } from './types';
export declare function calculateCallDataCost(callData: string): bigint;
export declare function getPaymasterSpoof(): string;
export declare function getSigForCalculations(): string;
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
    factory?: string | undefined;
    factoryData?: string | undefined;
    callData: string;
    callGasLimit: string;
    verificationGasLimit: string;
    preVerificationGas: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    paymaster?: string | undefined;
    paymasterVerificationGasLimit?: string | undefined;
    paymasterPostOpGasLimit?: string | undefined;
    paymasterData?: string | undefined;
    signature: string;
}[];
/**
 * Get the nonce we're expecting in validateUserOp
 * when we're going through the activation | recovery
 *
 * @param UserOperation userOperation
 * @returns hex string
 */
export declare function getOneTimeNonce(userOperation: UserOperation): string;
export declare function getRequestType(accountState: AccountOnchainState): UserOpRequestType;
export declare function shouldUseOneTimeNonce(accountState: AccountOnchainState): boolean;
export declare function getUserOperation(account: Account, accountState: AccountOnchainState, accountOp: AccountOp, bundler: BUNDLER, entryPointSig?: string): UserOperation;
export declare function isErc4337Broadcast(acc: Account, network: Network, accountState: AccountOnchainState): boolean;
export declare function shouldIncludeActivatorCall(network: Network, account: Account, accountState: AccountOnchainState, is4337Broadcast?: boolean): boolean | null;
export declare function shouldAskForEntryPointAuthorization(network: Network, account: Account, accountState: AccountOnchainState, alreadySigned: boolean): boolean | null;
export declare const ENTRY_POINT_AUTHORIZATION_REQUEST_ID = "ENTRY_POINT_AUTHORIZATION_REQUEST_ID";
export declare function getUserOpHash(userOp: UserOperation, chainId: bigint): string;
export declare const parseLogs: (logs: readonly Log[], userOpHash: string, userOpsLength?: number) => UserOperationEventData | null;
//# sourceMappingURL=userOperation.d.ts.map