import { Interface } from 'ethers';
export declare const WALLET_STAKING_COMMITMENT_RPC_TIMEOUT_MS = 6000;
export interface PendingWalletWithdrawal {
    shares: bigint;
    unlocksAt: bigint;
    maxTokens: bigint;
}
export interface WalletStakingRelayerLog {
    topics: string[];
    data: string;
}
export declare const walletStakingInterface: Interface;
export declare const LOG_LEAVE_TOPIC: string;
/** Uses the lock-time flow only when xWALLET can back every active commitment. */
export declare const shouldUsePendingWalletWithdrawalMode: (pendingWithdrawal: PendingWalletWithdrawal | null, xWalletBalance: bigint, totalPendingShares: bigint) => boolean;
/** Selects the latest active withdrawal and totals all shares needed to back active commitments. */
export declare const getPendingWalletWithdrawalSummary: (pendingWithdrawals: PendingWalletWithdrawal[]) => {
    latestWithdrawal: PendingWalletWithdrawal | null;
    totalShares: bigint;
};
/** Keeps active withdrawals whose commitment checks succeed and returns failures separately. */
export declare const getActivePendingWalletWithdrawals: (pendingWithdrawals: PendingWalletWithdrawal[], getCommitmentMaxTokens: (withdrawal: PendingWalletWithdrawal) => Promise<bigint>) => Promise<{
    activeWithdrawals: PendingWalletWithdrawal[];
    errors: unknown[];
}>;
/** Validates and extracts raw WALLET staking logs returned by the relayer. */
export declare const parseWalletStakingRelayerLogsResponse: (value: unknown) => WalletStakingRelayerLog[];
/**
 * Returns an account-specific key for the persisted pending withdrawal cache.
 *
 * @deprecated The UI wrote this cache (only the latest withdrawal) before the withdrawals moved to
 * the WalletTokenController, which stores them as leave logs under `walletStakingLeaveLogs`.
 * Nothing reads or writes this key any more.
 */
export declare const getPendingWalletWithdrawalStorageKey: (accountAddr: string) => string;
/**
 * Converts a persisted pending withdrawal into its runtime bigint representation.
 *
 * @deprecated Parses the pending withdrawal cache of `getPendingWalletWithdrawalStorageKey`,
 * which is no longer used.
 */
export declare const parseCachedPendingWalletWithdrawal: (value: unknown) => PendingWalletWithdrawal | null;
/** Decodes WALLET staking leave events owned by the selected account. */
export declare const decodePendingWalletWithdrawals: (logs: WalletStakingRelayerLog[], accountAddr: string) => PendingWalletWithdrawal[];
/** Returns the id that tells withdrawals apart (the contract keys commitments by it). */
export declare const getPendingWalletWithdrawalId: ({ shares, unlocksAt }: PendingWalletWithdrawal) => string;
/**
 * Decodes each WALLET staking leave log of the account and keeps one log per withdrawal. Logs of
 * other accounts, other events and logs that can't be decoded are dropped, so that the result is
 * safe to store.
 */
export declare const getUniqueAccountWalletStakingLeaveLogs: (logs: WalletStakingRelayerLog[], accountAddr: string) => {
    log: WalletStakingRelayerLog;
    withdrawal: PendingWalletWithdrawal;
}[];
/** Calculates the commitment key stored by the WALLET staking contract. */
export declare const getPendingWalletWithdrawalCommitmentId: (accountAddr: string, pendingWithdrawal: PendingWalletWithdrawal) => string;
/** Formats a future unlock timestamp as a compact day, hour and minute countdown. */
export declare const formatPendingWalletWithdrawalDuration: (unlocksAt: bigint, nowMs?: number) => string;
/** The contract only permits withdrawal after, rather than exactly at, unlocksAt. */
export declare const isPendingWalletWithdrawalReady: (unlocksAt: bigint, nowMs?: number) => boolean;
//# sourceMappingURL=pendingWithdrawal.d.ts.map