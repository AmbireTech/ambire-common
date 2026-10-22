import SafeApiKit from '@safe-global/api-kit';
import { Account, SafeAccountCreation } from '../../interfaces/account';
import { Hex } from '../../interfaces/hex';
import { Key } from '../../interfaces/keystore';
import { RPCProvider } from '../../interfaces/provider';
import { SafeAccountByOwner, SafeTx } from '../../interfaces/safe';
import { CallsUserRequest, TypedMessageUserRequest } from '../../interfaces/userRequest';
import { Call } from '../accountOp/types';
import type { SafeCreationInfoResponse, SafeMessage, SafeMessageListResponse, SafeMultisigTransactionListResponse } from '@safe-global/api-kit';
import type { EIP712TypedData, SafeMultisigConfirmationResponse, SafeMultisigTransactionResponse } from '@safe-global/types-kit';
export type ExtendedSafeMessage = SafeMessage & {
    isConfirmed: boolean;
};
export interface SafeResults {
    [chainId: string]: {
        txns: SafeMultisigTransactionResponse[];
        messages: ExtendedSafeMessage[];
    };
}
export declare function getApiKit(chainId: bigint): SafeApiKit;
type SafeDeploymentApiKitFactory = (chainId: bigint) => Pick<ReturnType<typeof getApiKit>, 'getSafeCreationInfo'>;
type SafeAccountApiKitFactory = (chainId: bigint) => Pick<ReturnType<typeof getApiKit>, 'getSafeInfo' | 'getSafeCreationInfo'>;
export declare function getSafeAccountByOwner(safeAddr: string, owner: Hex, deployedOn: bigint[], apiKitFactory?: SafeAccountApiKitFactory): Promise<{
    account: SafeAccountByOwner | null;
    failed: boolean;
}>;
export declare function getCalculatedSafeAddress(creation: SafeCreationInfoResponse, provider: RPCProvider): Promise<Hex | null>;
/** Returns whether all fields required to redeploy a Safe are available. */
export declare function hasCompleteSafeCreationData(creation: Partial<SafeAccountCreation> | null | undefined): boolean;
/**
 * Returns the Safe creation data available from the Safe Transaction Service, recovering missing
 * fields from the validated deployment transaction when possible.
 */
export declare function findDeployData(safeAddr: string, chainId: bigint, provider: RPCProvider, apiKitFactory?: SafeDeploymentApiKitFactory): Promise<SafeAccountCreation | Error>;
/**
 * Builds a Safe deployment call only when the stored creation data derives the imported address
 * and the configured singleton is deployed on the target network.
 */
export declare function getSafeDeploymentCall(account: Account, provider: RPCProvider): Promise<Call | null>;
/**
 * The setup() method is the same for v1.3, 1.4.1, 1.5. We decode it
 * to fetch the initial owners of the Safe so that we could put them
 * in the account associatedKeys
 */
export declare function decodeSetupData(setupData: Hex): Hex[];
/**
 * In Safe, the signatures need to be in order, starting with
 * the smallest ecrecover(sig) owner, ascending. Here, we
 * sort the owners in that way
 */
export declare function sortByAddress<T extends {
    addr: string;
}>(sortableKeys: T[]): T[];
export declare function getSafeTxnHash(typedData: TypedMessageUserRequest['meta']['params']): string;
export declare function propose(txn: SafeTx, chainId: bigint, safeAddress: Hex, owner: Hex, ownerSig: Hex, safeTxHash: string): Promise<void>;
export declare function confirm(chainId: bigint, ownerSig: Hex, safeTxHash: string): Promise<import("@safe-global/api-kit").SignatureResponse>;
export declare function addMessage(chainId: bigint, safeAddress: Hex, message: string | EIP712TypedData, signature: string, origin?: string): Promise<void>;
export declare function normalizeSafeGlobalMessage(message: string | EIP712TypedData): string | EIP712TypedData;
export declare function getMessage({ chainId, threshold, messageHash }: {
    chainId: bigint;
    threshold: number;
    messageHash: Hex;
}): Promise<ExtendedSafeMessage | null>;
export declare function addMessageSignature(chainId: bigint, hash: string, signature: string): Promise<void>;
export declare function getPendingTransactions(chainId: bigint, safeAddress: Hex): Promise<SafeMultisigTransactionListResponse & {
    chainId: bigint;
    type: string;
}>;
/**
 * Due to the nature of signatures, we cannot ask for confirmed
 * signatures as the moment the threshold for the account changes,
 * the validity of the signatures change as well.
 * Removing an owner would do the same.
 * So we fetch the newest 15 and filter them on a higher level
 */
export declare function getLatestMessages(chainId: bigint, safeAddress: Hex): Promise<SafeMessageListResponse & {
    chainId: bigint;
    type: string;
}>;
export declare function fetchAllPending(networks: {
    chainId: bigint;
    threshold: number;
}[], safeAddr: Hex): Promise<SafeResults | null>;
export declare function toCallsUserRequest(safeAddr: Hex, response: SafeResults): {
    type: 'calls';
    params: {
        userRequestParams: {
            calls: CallsUserRequest['signAccountOp']['accountOp']['calls'];
            meta: CallsUserRequest['meta'] & {
                safeTxnProps: {
                    txnId: Hex;
                    signature: Hex;
                    nonce: bigint;
                };
                safeTx: SafeMultisigTransactionResponse;
            };
        };
        executionType: 'queue';
    };
}[];
export declare function toSigMessageUserRequests(response: SafeResults): {
    type: 'safeSignMessageRequest';
    params: {
        chainId: bigint;
        signed: string[];
        message: Hex | EIP712TypedData;
        messageHash: Hex;
        signature: Hex;
        created: number;
        signatures: Hex[];
        dappName?: string;
        dappUrl?: string;
    };
    isConfirmed: boolean;
}[];
export declare function getAlreadySignedOwners(signature: string, hash: string, safeTx?: SafeMultisigTransactionResponse): string[];
export declare function getImportedSignersThatHaveNotSigned(signed: string[], importedOwners: string[]): string[];
/**
 * Whether the imported owners of a Safe can reach its threshold with hot (keystore held) keys
 * alone. Hardware wallets and cards confirm on the device, so they do not count towards it.
 */
export declare function canHotOwnersMeetSafeThreshold(importedOwners: Pick<Key, 'type'>[], threshold: number): boolean;
export declare function getSigs(signature?: string | null): Hex[];
export declare function sortSigs(signatures: Hex[], hash: string, confirmations?: {
    owner: string;
    signature: string;
}[]): Hex;
/**
 * Fetch the Safe transactions of an account on each of the passed chains.
 * `minNonce` is the smallest nonce we are still waiting on for that chain -
 * transactions below it can no longer execute, so the API does not have to
 * return them.
 */
export declare function fetchExecutedTransactions(safeAddr: Hex, chains: {
    chainId: bigint;
    minNonce: number;
}[]): Promise<{
    safeTxnHash: Hex;
    nonce: string;
    transactionHash?: Hex;
    confirmations?: SafeMultisigConfirmationResponse[];
}[]>;
export declare function getNonce(safeAddr: string, provider: RPCProvider): Promise<bigint>;
export {};
//# sourceMappingURL=safe.d.ts.map