import { Dapp } from '../../interfaces/dapp';
import { Hex } from '../../interfaces/hex';
export declare enum AccountOpStatus {
    Pending = "pending",
    BroadcastedButNotConfirmed = "broadcasted-but-not-confirmed",
    Success = "success",
    Failure = "failure",
    Rejected = "rejected",
    UnknownButPastNonce = "unknown-but-past-nonce",
    BroadcastButStuck = "broadcast-but-stuck",
    PartiallyComplete = "partially-complete"
}
export type CallTuple = [string | undefined, string, string];
export interface Call {
    id?: string;
    /**
     * Omitted in case of contract deployment transactions
     */
    to?: string;
    value: bigint;
    data: string;
    txnId?: Hex;
    status?: AccountOpStatus;
    blockNumber?: number;
    blockHash?: string;
    gasUsed?: string;
    fee?: {
        inToken: string;
        amount: bigint;
    };
    validationError?: string;
    dapp?: Dapp;
    dappPromiseId?: string;
    activeRouteId?: string;
}
//# sourceMappingURL=types.d.ts.map