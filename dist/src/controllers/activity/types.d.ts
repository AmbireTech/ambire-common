import { AccountId } from '../../interfaces/account';
import { Message } from '../../interfaces/userRequest';
export interface SignedMessage extends Message {
    dapp: {
        name: string;
        icon: string;
    } | null;
    timestamp: number;
}
export interface InternalSignedMessages {
    [key: AccountId]: SignedMessage[];
}
/**
 * Persistent index of where the user has sent funds. Serves two purposes:
 * 1. per-account "have I sent to this address before" (fast path for `hasAccountOpsSentTo`), and
 * 2. "what address did this domain resolve to the last time I sent to it" (ENS/Namoshi
 * changed-address protection). (from any account)
 */
export interface SentToHistory {
    domains: {
        [domain: string]: {
            address: string;
            sentAt: number;
        };
    };
    recipients: {
        [accountId: string]: {
            [toAddress: string]: number;
        };
    };
}
/**
 * Persistent index of the other accounts (EOAs) that paid the fee for an account's transactions,
 * per account and chain, with the timestamp of the latest payment of each. Broadcasting from an
 * EOA publicly links it to the account (e.g. a Safe), so this tells which payers are already
 * linked and which would be linked for the first time, and which one paid last.
 * Addresses are checksummed. Kept separately from the activity history so it outlives its
 * MAX_OPS_PER_GROUP eviction and the startup window that loads only the recent ops.
 */
export interface FeePayersHistory {
    [accountId: string]: {
        [chainId: string]: {
            [paidBy: string]: number;
        };
    };
}
//# sourceMappingURL=types.d.ts.map