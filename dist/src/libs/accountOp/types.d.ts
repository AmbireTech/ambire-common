import { Hex } from '../../interfaces/hex';
import { Calls, UserRequest } from '../../interfaces/userRequest';
export declare enum AccountOpStatus {
    Pending = "pending",
    BroadcastedButNotConfirmed = "broadcasted-but-not-confirmed",
    Success = "success",
    Failure = "failure",
    Rejected = "rejected",
    UnknownButPastNonce = "unknown-but-past-nonce",
    BroadcastButStuck = "broadcast-but-stuck"
}
export interface Call {
    to: string;
    value: bigint;
    data: string;
    fromUserRequestId?: UserRequest['id'];
    id?: Calls['calls'][number]['id'];
    txnId?: Hex;
    status?: AccountOpStatus;
    fee?: {
        inToken: string;
        amount: bigint;
    };
}
//# sourceMappingURL=types.d.ts.map