import { SafeCreationInfoResponse, SafeMessage, SafeMessageListResponse, SafeMultisigTransactionListResponse } from '@safe-global/api-kit';
import { EIP712TypedData, SafeMultisigConfirmationResponse, SafeMultisigTransactionResponse } from '@safe-global/types-kit';
import { AccountOnchainState } from '../../interfaces/account';
import { Hex } from '../../interfaces/hex';
import { RPCProvider } from '../../interfaces/provider';
import { SafeTx } from '../../interfaces/safe';
import { CallsUserRequest, TypedMessageUserRequest } from '../../interfaces/userRequest';
import { AccountOp } from '../accountOp/accountOp';
export type ExtendedSafeMessage = SafeMessage & {
    isConfirmed: boolean;
};
export interface SafeResults {
    [chainId: string]: {
        txns: SafeMultisigTransactionResponse[];
        messages: ExtendedSafeMessage[];
    };
}
export declare function encodeCalls(op: AccountOp): {
    to: Hex;
    value: bigint;
    data: Hex;
    operation: number;
};
export declare function getCalculatedSafeAddress(creation: SafeCreationInfoResponse, provider: RPCProvider): Promise<Hex | null>;
/**
 * The setup() method is the same for v1.3, 1.4.1, 1.5. We decode it
 * to fetch the initial owners of the Safe so that we could put them
 * in the account associatedKeys
 */
export declare function decodeSetupData(setupData: Hex): Hex[];
/**
 * Construct a Safe txn for signing
 */
export declare function getSafeTxn(op: AccountOp, state: AccountOnchainState): SafeTx;
export declare function getSafeBroadcastTxn(op: AccountOp, state: AccountOnchainState): {
    to: Hex;
    value: bigint;
    data: Hex;
};
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
export declare function addMessage(chainId: bigint, safeAddress: Hex, message: string | EIP712TypedData, signature: string): Promise<void>;
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
export declare function getTransaction(chainId: bigint, safeTxnHash: Hex): Promise<SafeMultisigTransactionResponse>;
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
    };
    isConfirmed: boolean;
}[];
export declare function getAlreadySignedOwners(signature: string, hash: string, safeTx?: SafeMultisigTransactionResponse): string[];
export declare function getImportedSignersThatHaveNotSigned(signed: string[], importedOwners: string[]): string[];
export declare function getSigs(signature?: string | null): Hex[];
export declare function sortSigs(signatures: Hex[], hash: string, confirmations?: {
    owner: string;
    signature: string;
}[]): Hex;
/**
 * Safe requests may have multiple "call" ones with the same nonce
 */
export declare function getSameNonceRequests(requests: CallsUserRequest[]): {
    [nonce: string]: CallsUserRequest[];
};
export declare function fetchExecutedTransactions(txns: {
    chainId: bigint;
    safeTxnHash: Hex;
}[]): Promise<{
    safeTxnHash: Hex;
    nonce: string;
    transactionHash?: Hex;
    confirmations?: SafeMultisigConfirmationResponse[];
}[]>;
export declare function getNonce(safeAddr: string, provider: RPCProvider): Promise<bigint>;
//# sourceMappingURL=safe.d.ts.map