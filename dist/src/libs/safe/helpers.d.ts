import { AccountOnchainState } from '../../interfaces/account';
import { Hex } from '../../interfaces/hex';
import { SafeTx } from '../../interfaces/safe';
import { CallsUserRequest } from '../../interfaces/userRequest';
import { AccountOp } from '../accountOp/accountOp';
export declare const multiCallAbi: ({
    inputs: any[];
    stateMutability: string;
    type: string;
    name?: undefined;
    outputs?: undefined;
} | {
    inputs: {
        internalType: string;
        name: string;
        type: string;
    }[];
    name: string;
    outputs: any[];
    stateMutability: string;
    type: string;
})[];
export declare const SAFE_CALL_OPERATION = 0;
export declare const SAFE_DELEGATE_CALL_OPERATION = 1;
export declare function encodeCalls(op: AccountOp): {
    to: Hex;
    value: bigint;
    data: Hex;
    operation: number;
};
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
 * A single Gnosis Safe MultiSend entry, decoded from its packed byte encoding.
 */
export interface SuccessfullyDecoded {
    success: true;
    operation: number;
    to: string;
    value: bigint;
    data: string;
}
/**
 * A MultiSend entry that could not be decoded because the remaining bytes don't
 * hold a full, well-formed entry (e.g. truncated or malformed calldata).
 */
export interface FailedDecoded {
    success: false;
    /** Human-readable reason the remaining bytes couldn't be read as a MultiSend entry */
    reason: string;
}
export declare function decodeMultiSend(transactionsHex: string): (SuccessfullyDecoded | FailedDecoded)[];
/**
 * The requesting dapp is only known on the device that originates the message.
 * We stamp its name and url into Safe's `origin` field so other owners co-signing
 * on a different device can see the request context (they fetch the message from
 * the Safe Transaction Service, which carries no dapp identity of its own).
 * `origin` is capped at 200 chars; if it doesn't fit we skip it rather than risk
 * the message proposal failing validation (missing metadata is recoverable).
 */
export declare function buildSafeMessageOrigin(dapp: {
    name?: string;
    url?: string;
} | null): string | undefined;
export declare function parseSafeMessageOrigin(origin?: string): {
    name?: string;
    url?: string;
};
/**
 * Safe requests may have multiple "call" ones with the same nonce
 */
export declare function getSameNonceRequests(requests: CallsUserRequest[]): {
    [nonce: string]: CallsUserRequest[];
};
//# sourceMappingURL=helpers.d.ts.map