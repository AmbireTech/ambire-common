"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPendingWalletWithdrawalReady = exports.formatPendingWalletWithdrawalDuration = exports.getPendingWalletWithdrawalCommitmentId = exports.getUniqueAccountWalletStakingLeaveLogs = exports.getPendingWalletWithdrawalId = exports.decodePendingWalletWithdrawals = exports.parseCachedPendingWalletWithdrawal = exports.getPendingWalletWithdrawalStorageKey = exports.parseWalletStakingRelayerLogsResponse = exports.getActivePendingWalletWithdrawals = exports.getPendingWalletWithdrawalSummary = exports.shouldUsePendingWalletWithdrawalMode = exports.LOG_LEAVE_TOPIC = exports.walletStakingInterface = exports.WALLET_STAKING_COMMITMENT_RPC_TIMEOUT_MS = void 0;
const ethers_1 = require("ethers");
exports.WALLET_STAKING_COMMITMENT_RPC_TIMEOUT_MS = 6000;
exports.walletStakingInterface = new ethers_1.Interface([
    'function commitments(bytes32) view returns (uint256)',
    'function withdraw(uint256 shares, uint256 unlocksAt, bool skipMint)',
    'event LogLeave(address indexed owner, uint256 shares, uint256 unlocksAt, uint256 maxTokens)'
]);
exports.LOG_LEAVE_TOPIC = exports.walletStakingInterface.getEvent('LogLeave').topicHash;
/** Uses the lock-time flow only when xWALLET can back every active commitment. */
const shouldUsePendingWalletWithdrawalMode = (pendingWithdrawal, xWalletBalance, totalPendingShares) => !!pendingWithdrawal && xWalletBalance >= totalPendingShares;
exports.shouldUsePendingWalletWithdrawalMode = shouldUsePendingWalletWithdrawalMode;
/** Selects the latest active withdrawal and totals all shares needed to back active commitments. */
const getPendingWalletWithdrawalSummary = (pendingWithdrawals) => pendingWithdrawals.reduce((summary, withdrawal) => ({
    latestWithdrawal: !summary.latestWithdrawal || withdrawal.unlocksAt > summary.latestWithdrawal.unlocksAt
        ? withdrawal
        : summary.latestWithdrawal,
    totalShares: summary.totalShares + withdrawal.shares
}), { latestWithdrawal: null, totalShares: 0n });
exports.getPendingWalletWithdrawalSummary = getPendingWalletWithdrawalSummary;
/** Keeps active withdrawals whose commitment checks succeed and returns failures separately. */
const getActivePendingWalletWithdrawals = async (pendingWithdrawals, getCommitmentMaxTokens) => {
    const results = await Promise.allSettled(pendingWithdrawals.map(async (withdrawal) => ({
        withdrawal,
        maxTokens: await getCommitmentMaxTokens(withdrawal)
    })));
    return results.reduce((summary, result) => {
        if (result.status === 'rejected') {
            summary.errors.push(result.reason);
        }
        else if (result.value.maxTokens > 0n) {
            summary.activeWithdrawals.push({
                ...result.value.withdrawal,
                maxTokens: result.value.maxTokens
            });
        }
        return summary;
    }, { activeWithdrawals: [], errors: [] });
};
exports.getActivePendingWalletWithdrawals = getActivePendingWalletWithdrawals;
/** Validates and extracts raw WALLET staking logs returned by the relayer. */
const parseWalletStakingRelayerLogsResponse = (value) => {
    if (!value || typeof value !== 'object')
        throw new Error('The relayer returned invalid data.');
    const response = value;
    if (response.success !== true) {
        throw new Error(typeof response.message === 'string'
            ? response.message
            : 'The relayer could not load pending withdrawals.');
    }
    const logs = response.data?.logs;
    if (!Array.isArray(logs) ||
        logs.some((log) => !log ||
            typeof log !== 'object' ||
            !Array.isArray(log.topics) ||
            log.topics.some((topic) => typeof topic !== 'string') ||
            typeof log.data !== 'string')) {
        throw new Error('The relayer returned invalid pending withdrawal data.');
    }
    return logs;
};
exports.parseWalletStakingRelayerLogsResponse = parseWalletStakingRelayerLogsResponse;
/**
 * Returns an account-specific key for the persisted pending withdrawal cache.
 *
 * @deprecated The UI wrote this cache (only the latest withdrawal) before the withdrawals moved to
 * the WalletTokenController, which stores them as leave logs under `walletStakingLeaveLogs`.
 * Nothing reads or writes this key any more.
 */
const getPendingWalletWithdrawalStorageKey = (accountAddr) => `walletStakingPendingWithdrawal:${accountAddr.toLowerCase()}`;
exports.getPendingWalletWithdrawalStorageKey = getPendingWalletWithdrawalStorageKey;
/**
 * Converts a persisted pending withdrawal into its runtime bigint representation.
 *
 * @deprecated Parses the pending withdrawal cache of `getPendingWalletWithdrawalStorageKey`,
 * which is no longer used.
 */
const parseCachedPendingWalletWithdrawal = (value) => {
    if (!value || typeof value !== 'object')
        return null;
    const { shares, unlocksAt, maxTokens } = value;
    if (typeof shares !== 'string' ||
        typeof unlocksAt !== 'string' ||
        typeof maxTokens !== 'string') {
        return null;
    }
    try {
        const pendingWithdrawal = {
            shares: BigInt(shares),
            unlocksAt: BigInt(unlocksAt),
            maxTokens: BigInt(maxTokens)
        };
        if (pendingWithdrawal.shares <= 0n ||
            pendingWithdrawal.unlocksAt <= 0n ||
            pendingWithdrawal.maxTokens <= 0n) {
            return null;
        }
        return pendingWithdrawal;
    }
    catch {
        return null;
    }
};
exports.parseCachedPendingWalletWithdrawal = parseCachedPendingWalletWithdrawal;
/** Decodes WALLET staking leave events owned by the selected account. */
const decodePendingWalletWithdrawals = (logs, accountAddr) => logs.flatMap(({ topics, data }) => {
    if (topics[0]?.toLowerCase() !== exports.LOG_LEAVE_TOPIC.toLowerCase())
        return [];
    const { owner, shares, unlocksAt, maxTokens } = exports.walletStakingInterface.decodeEventLog('LogLeave', data, topics);
    if (String(owner).toLowerCase() !== accountAddr.toLowerCase())
        return [];
    return [
        {
            shares: BigInt(shares),
            unlocksAt: BigInt(unlocksAt),
            maxTokens: BigInt(maxTokens)
        }
    ];
});
exports.decodePendingWalletWithdrawals = decodePendingWalletWithdrawals;
/** Returns the id that tells withdrawals apart (the contract keys commitments by it). */
const getPendingWalletWithdrawalId = ({ shares, unlocksAt }) => `${shares}:${unlocksAt}`;
exports.getPendingWalletWithdrawalId = getPendingWalletWithdrawalId;
/**
 * Decodes each WALLET staking leave log of the account and keeps one log per withdrawal. Logs of
 * other accounts, other events and logs that can't be decoded are dropped, so that the result is
 * safe to store.
 */
const getUniqueAccountWalletStakingLeaveLogs = (logs, accountAddr) => {
    const entriesById = new Map();
    logs.forEach((log) => {
        let withdrawals;
        try {
            withdrawals = (0, exports.decodePendingWalletWithdrawals)([log], accountAddr);
        }
        catch {
            return;
        }
        const [withdrawal] = withdrawals;
        if (!withdrawal)
            return;
        entriesById.set((0, exports.getPendingWalletWithdrawalId)(withdrawal), {
            log: { topics: [...log.topics], data: log.data },
            withdrawal
        });
    });
    return Array.from(entriesById.values());
};
exports.getUniqueAccountWalletStakingLeaveLogs = getUniqueAccountWalletStakingLeaveLogs;
/** Calculates the commitment key stored by the WALLET staking contract. */
const getPendingWalletWithdrawalCommitmentId = (accountAddr, pendingWithdrawal) => (0, ethers_1.keccak256)(ethers_1.AbiCoder.defaultAbiCoder().encode(['address', 'uint256', 'uint256'], [accountAddr, pendingWithdrawal.shares, pendingWithdrawal.unlocksAt]));
exports.getPendingWalletWithdrawalCommitmentId = getPendingWalletWithdrawalCommitmentId;
/** Formats a future unlock timestamp as a compact day, hour and minute countdown. */
const formatPendingWalletWithdrawalDuration = (unlocksAt, nowMs = Date.now()) => {
    const remainingMinutes = Math.max(0, Math.ceil((Number(unlocksAt) * 1000 - nowMs) / 60_000));
    const days = Math.floor(remainingMinutes / 1440);
    const hours = Math.floor((remainingMinutes % 1440) / 60);
    const minutes = remainingMinutes % 60;
    return `${days}d ${hours}h ${minutes}m`;
};
exports.formatPendingWalletWithdrawalDuration = formatPendingWalletWithdrawalDuration;
/** The contract only permits withdrawal after, rather than exactly at, unlocksAt. */
const isPendingWalletWithdrawalReady = (unlocksAt, nowMs = Date.now()) => BigInt(Math.floor(nowMs / 1000)) > unlocksAt;
exports.isPendingWalletWithdrawalReady = isPendingWalletWithdrawalReady;
//# sourceMappingURL=pendingWithdrawal.js.map