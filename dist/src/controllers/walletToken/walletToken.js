"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletTokenController = exports.WALLET_STAKING_RELAYER_LOGS_TIMEOUT_MS = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const addresses_1 = require("../../consts/addresses");
const localWithdrawals_1 = require("../../libs/walletStaking/localWithdrawals");
const pendingWithdrawal_1 = require("../../libs/walletStaking/pendingWithdrawal");
const shareValue_1 = require("../../libs/walletStaking/shareValue");
const with_timeout_1 = require("../../utils/with-timeout");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
exports.WALLET_STAKING_RELAYER_LOGS_TIMEOUT_MS = 5000;
/**
 * Loads the pending $WALLET withdrawals (unstakes) of each account. The xWALLET conversion rate
 * that the portfolio shows is loaded by the portfolio itself (`getWalletStakingShareValue`).
 *
 * The withdrawals are found from the staking contract's leave logs. The relayer returns them,
 * but that sends the account address to the relayer, so the user can opt out
 * (`walletStakingWithdrawalsLookup`). Then the logs are read from the receipts of the unstake
 * transactions made from this device and of the transaction IDs that the user enters. The logs
 * of active withdrawals are stored, so a withdrawal found once stays known.
 */
class WalletTokenController extends eventEmitter_1.default {
    #storage;
    #featureFlags;
    #providers;
    #callRelayer;
    #activity;
    /** The stored leave logs, keyed by the lowercase account address. */
    #leaveLogs = {};
    #loadRequestIds = new Map();
    #storageWriteQueue = Promise.resolve();
    pendingWithdrawals = {};
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    constructor({ eventEmitterRegistry, storage, featureFlags, providers, callRelayer, activity }) {
        super(eventEmitterRegistry);
        this.#storage = storage;
        this.#featureFlags = featureFlags;
        this.#providers = providers;
        this.#callRelayer = callRelayer;
        this.#activity = activity;
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    async #load() {
        try {
            this.#leaveLogs = await this.#storage.get('walletStakingLeaveLogs', {});
        }
        catch (error) {
            this.emitError({
                level: 'silent',
                message: 'Unable to load the stored $WALLET withdrawals.',
                error: error instanceof Error ? error : new Error('Unable to load the leave logs.')
            });
        }
    }
    /** Loads the account's pending $WALLET withdrawals into `pendingWithdrawals`. */
    async loadPendingWithdrawals(accountAddr) {
        await this.#refreshPendingWithdrawals(accountAddr, null);
    }
    /**
     * Looks for the account's pending withdrawal in a transaction that the user entered. The leave
     * logs found in it are stored, as if the relayer had returned them. The transaction ID itself
     * is not stored.
     */
    async findPendingWithdrawalInTxn(accountAddr, txnId) {
        const normalizedTxnId = txnId.trim().toLowerCase();
        if (!(0, ethers_1.isHexString)(normalizedTxnId, 32)) {
            this.#setAccountPendingWithdrawals(accountAddr, { txnIdLookupError: 'invalid' });
            return;
        }
        this.#setAccountPendingWithdrawals(accountAddr, {
            isTxnIdLookupLoading: true,
            txnIdLookupError: null
        });
        let txnLeaveLogs = [];
        try {
            await this.initialLoadPromise;
            const { results, errors } = await (0, localWithdrawals_1.findWalletStakingLeaveLogsInTxns)([normalizedTxnId], accountAddr, this.#getEthereumProvider());
            if (errors.length)
                throw errors[0];
            txnLeaveLogs = results[0]?.logs || [];
        }
        catch (error) {
            this.emitError({
                level: 'silent',
                message: 'Unable to check the unstake transaction.',
                error: error instanceof Error ? error : new Error('Unable to check the transaction.')
            });
            this.#setAccountPendingWithdrawals(accountAddr, {
                isTxnIdLookupLoading: false,
                txnIdLookupError: 'failed'
            });
            return;
        }
        if (!txnLeaveLogs.length) {
            this.#setAccountPendingWithdrawals(accountAddr, {
                isTxnIdLookupLoading: false,
                txnIdLookupError: 'not-found'
            });
            return;
        }
        // Kept in memory right away, so that a load that runs meanwhile also checks these logs. The
        // load stores them if their withdrawals are still active
        const accountKey = accountAddr.toLowerCase();
        this.#leaveLogs[accountKey] = [...(this.#leaveLogs[accountKey] || []), ...txnLeaveLogs];
        const txnWithdrawalIds = (0, pendingWithdrawal_1.getUniqueAccountWalletStakingLeaveLogs)(txnLeaveLogs, accountAddr).map(({ withdrawal }) => (0, pendingWithdrawal_1.getPendingWalletWithdrawalId)(withdrawal));
        await this.#refreshPendingWithdrawals(accountAddr, (activeWithdrawals) => {
            const activeWithdrawalIds = new Set(activeWithdrawals.map(pendingWithdrawal_1.getPendingWalletWithdrawalId));
            return txnWithdrawalIds.some((id) => activeWithdrawalIds.has(id)) ? null : 'not-found';
        });
        // Also cleared when a newer load replaced this one, which then leaves the state as it is
        this.#setAccountPendingWithdrawals(accountAddr, { isTxnIdLookupLoading: false });
    }
    /**
     * Finds the account's leave logs, checks which withdrawals are still committed in the staking
     * contract and updates the state. `getTxnIdLookupError` sets the lookup error of a transaction
     * that the user entered, based on the active withdrawals.
     */
    async #refreshPendingWithdrawals(accountAddr, getTxnIdLookupError) {
        const accountKey = accountAddr.toLowerCase();
        const requestId = (this.#loadRequestIds.get(accountKey) || 0) + 1;
        this.#loadRequestIds.set(accountKey, requestId);
        const isStale = () => this.#loadRequestIds.get(accountKey) !== requestId;
        // A lookup of a transaction that the user entered keeps the current status, so that the
        // screen isn't replaced with a loader while the entered transaction is checked
        if (!getTxnIdLookupError) {
            this.#setAccountPendingWithdrawals(accountAddr, { status: 'loading', txnIdLookupError: null });
        }
        try {
            await this.initialLoadPromise;
            // Until the stored flags load, the flag has its default (on), so reading it earlier could
            // send the account address to the relayer although the user opted out
            await this.#featureFlags.initialLoadPromise;
            const provider = this.#getEthereumProvider();
            // A relayer failure doesn't hide the withdrawals that are already stored
            let hasRelayerFailed = false;
            const foundLeaveLogs = this.#featureFlags.isFeatureEnabled('walletStakingWithdrawalsLookup')
                ? await this.#getRelayerLeaveLogs(accountAddr).catch((error) => {
                    hasRelayerFailed = true;
                    this.emitError({
                        level: 'silent',
                        message: 'Unable to load the pending $WALLET withdrawals.',
                        error: error instanceof Error ? error : new Error('Unable to load the leave logs.')
                    });
                    return [];
                })
                : await this.#getLocalTxnsLeaveLogs(accountAddr, provider);
            const leaveLogEntries = (0, pendingWithdrawal_1.getUniqueAccountWalletStakingLeaveLogs)([...(this.#leaveLogs[accountKey] || []), ...foundLeaveLogs], accountAddr);
            const contract = new ethers_1.Contract(addresses_1.WALLET_STAKING_ADDR, pendingWithdrawal_1.walletStakingInterface, provider);
            const getCommitment = contract.commitments;
            if (typeof getCommitment !== 'function') {
                throw new Error('Pending WALLET withdrawals are unavailable.');
            }
            const { activeWithdrawals, errors: commitmentErrors } = await (0, pendingWithdrawal_1.getActivePendingWalletWithdrawals)(leaveLogEntries.map(({ withdrawal }) => withdrawal), async (withdrawal) => BigInt(await (0, with_timeout_1.withTimeout)(() => getCommitment((0, pendingWithdrawal_1.getPendingWalletWithdrawalCommitmentId)(accountAddr, withdrawal)), {
                timeoutMs: pendingWithdrawal_1.WALLET_STAKING_COMMITMENT_RPC_TIMEOUT_MS,
                message: 'Pending WALLET withdrawals took too long to load.'
            })));
            if (isStale())
                return;
            commitmentErrors.forEach((error) => {
                this.emitError({
                    level: 'silent',
                    message: 'Unable to check a pending $WALLET withdrawal.',
                    error: error instanceof Error ? error : new Error('Unable to check a commitment.')
                });
            });
            const { latestWithdrawal, totalShares } = (0, pendingWithdrawal_1.getPendingWalletWithdrawalSummary)(activeWithdrawals);
            this.#setAccountPendingWithdrawals(accountAddr, {
                status: hasRelayerFailed || commitmentErrors.length ? 'error' : 'loaded',
                latestWithdrawal,
                totalShares,
                ...(getTxnIdLookupError && { txnIdLookupError: getTxnIdLookupError(activeWithdrawals) })
            });
            // Withdrawn commitments are pruned, but only when every check succeeded, so that a failed
            // check doesn't drop a withdrawal that is still pending
            const activeWithdrawalIds = new Set(activeWithdrawals.map(pendingWithdrawal_1.getPendingWalletWithdrawalId));
            const leaveLogsToStore = commitmentErrors.length
                ? leaveLogEntries
                : leaveLogEntries.filter(({ withdrawal }) => activeWithdrawalIds.has((0, pendingWithdrawal_1.getPendingWalletWithdrawalId)(withdrawal)));
            await this.#storeLeaveLogs(accountKey, leaveLogsToStore.map(({ log }) => log));
        }
        catch (error) {
            if (isStale())
                return;
            this.emitError({
                level: 'silent',
                message: 'Unable to load the pending $WALLET withdrawals.',
                error: error instanceof Error ? error : new Error('Unable to load the withdrawals.')
            });
            this.#setAccountPendingWithdrawals(accountAddr, {
                status: 'error',
                ...(getTxnIdLookupError && { txnIdLookupError: 'failed' })
            });
        }
    }
    async #getRelayerLeaveLogs(accountAddr) {
        const response = await this.#callRelayer('/v2/identity/logs', 'POST', {
            identity: accountAddr,
            address: addresses_1.WALLET_STAKING_ADDR,
            requestedTopic: pendingWithdrawal_1.LOG_LEAVE_TOPIC
        }, undefined, exports.WALLET_STAKING_RELAYER_LOGS_TIMEOUT_MS);
        return (0, pendingWithdrawal_1.parseWalletStakingRelayerLogsResponse)(response);
    }
    /**
     * Reads the leave logs from the receipts of the unstake transactions made from this device. A
     * receipt that fails to load is reported, and the other receipts are still used.
     */
    async #getLocalTxnsLeaveLogs(accountAddr, provider) {
        const accountOps = await this.#activity.getInternalAccountOps(accountAddr, shareValue_1.WALLET_STAKING_CHAIN_ID);
        const txnIds = (0, localWithdrawals_1.getWalletStakingLeaveTxnIds)(accountOps);
        if (!txnIds.length)
            return [];
        const { results, errors } = await (0, localWithdrawals_1.findWalletStakingLeaveLogsInTxns)(txnIds, accountAddr, provider);
        errors.forEach((error) => {
            this.emitError({ level: 'silent', message: 'Unable to load an unstake transaction.', error });
        });
        return results.flatMap(({ logs }) => logs);
    }
    #getEthereumProvider() {
        const provider = this.#providers.providers[shareValue_1.WALLET_STAKING_CHAIN_ID.toString()];
        if (!provider)
            throw new Error('walletToken: the Ethereum provider is not available');
        return provider;
    }
    #setAccountPendingWithdrawals(accountAddr, update) {
        this.pendingWithdrawals[accountAddr] = {
            status: 'loading',
            latestWithdrawal: null,
            totalShares: 0n,
            txnIdLookupError: null,
            isTxnIdLookupLoading: false,
            ...this.pendingWithdrawals[accountAddr],
            ...update
        };
        this.emitUpdate();
    }
    /** Stores the account's leave logs. The writes are queued, so they never run in parallel. */
    async #storeLeaveLogs(accountKey, logs) {
        if (logs.length)
            this.#leaveLogs[accountKey] = logs;
        else
            delete this.#leaveLogs[accountKey];
        this.#storageWriteQueue = this.#storageWriteQueue
            .then(() => this.#storage.set('walletStakingLeaveLogs', { ...this.#leaveLogs }))
            .catch((error) => {
            this.emitError({
                level: 'silent',
                message: 'Unable to store the pending $WALLET withdrawals.',
                error: error instanceof Error ? error : new Error('Unable to store the leave logs.')
            });
        });
        await this.#storageWriteQueue;
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON()
        };
    }
}
exports.WalletTokenController = WalletTokenController;
//# sourceMappingURL=walletToken.js.map