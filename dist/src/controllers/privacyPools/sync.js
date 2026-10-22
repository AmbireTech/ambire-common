"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrivacyPoolsSync = void 0;
const privacyPools_1 = require("../../consts/privacyPools");
/** An account's chain before its first sync. */
const IDLE_ACCOUNT_CHAIN_STATE = {
    syncStatus: 'idle',
    syncStartedAt: null,
    error: null,
    lastSyncedAt: null,
    lastSyncDuration: null,
    notes: []
};
/** The `whenDone` of a chain's first sync on this run, with what settles it. */
const createInitialChainRead = () => {
    let resolve = () => { };
    let reject = () => { };
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
};
/**
 * Syncing: every account syncs every chain in parallel, and asking again while a sync runs joins
 * it. Only a chain's shared state - the same for every account, and minutes to read the first
 * time - is read once: the other syncs of the chain wait for that read, then read only new blocks.
 */
class PrivacyPoolsSync {
    #ctx;
    #registry;
    /** Per chain - see `InitialChainSync`. */
    #initialChainSyncs = {};
    /** The running sync per account and chain. Asking again while it runs joins it. */
    #syncQueue = {};
    /** Per account and chain: its sync and its notes. Written only through `#writeAccountState`. */
    #accountStates = {};
    /** Completed syncs per account and chain. A deposit precommitment is valid until the next one. */
    #syncEpochs = {};
    constructor(ctx, registry) {
        this.#ctx = ctx;
        this.#registry = registry;
    }
    getAccountChainStates(seedId) {
        return this.#accountStates[seedId] || {};
    }
    /** The running sync of an account's chain, if any. */
    getRunningSync(seedId, chainId) {
        return this.#syncQueue[seedId]?.[chainId] || null;
    }
    getEpoch(chainId, seedId) {
        return this.#syncEpochs[seedId]?.[chainId] || 0;
    }
    /** Per chain: an account's sync of it, with what this device knows of its shared state. */
    getChainStates(seedId, supportedChainIds) {
        const accountChains = (seedId && this.#accountStates[seedId]) || {};
        const chainIds = new Set([
            ...supportedChainIds,
            ...Object.keys(this.#initialChainSyncs),
            ...Object.keys(accountChains)
        ]);
        return Object.fromEntries([...chainIds].map((chainId) => {
            // Picked by name, not spread: notes and the initial sync's `whenDone` never reach the UI
            const { syncStatus, syncStartedAt, error, lastSyncedAt, lastSyncDuration } = accountChains[chainId] || IDLE_ACCOUNT_CHAIN_STATE;
            const initialSync = this.#initialChainSyncs[chainId];
            return [
                chainId,
                {
                    chainId,
                    syncStatus,
                    syncStartedAt,
                    error,
                    isInitialSyncDone: initialSync?.isDone ?? null,
                    initialSyncDuration: initialSync?.durationMs ?? null,
                    lastSyncedAt,
                    lastSyncDuration
                }
            ];
        }));
    }
    /**
     * Reads a chain's notes for any account, beside the syncs of other accounts and chains, and
     * joins the running one if there is one. Which sync reads the chain's shared state is decided
     * here, with no await in between, so exactly one does.
     */
    queue(chainId, seedId) {
        const runningSync = this.#syncQueue[seedId]?.[chainId];
        if (runningSync)
            return runningSync;
        const generation = this.#ctx.lock.current;
        // At once, so a sync waiting for the chain's first read already reads as under way
        this.#writeAccountState(seedId, chainId, generation, {
            syncStatus: 'syncing',
            syncStartedAt: Date.now(),
            error: null
        });
        this.#ctx.emitUpdate();
        const initialSyncDone = this.#initialChainSyncs[chainId]?.whenDone || null;
        const initialRead = initialSyncDone ? null : createInitialChainRead();
        if (initialRead) {
            // Reported by the sync whose read failed, while the ones waiting fail with it
            initialRead.promise.catch(() => { });
            this.#writeInitialChainSync(chainId, { whenDone: initialRead.promise });
        }
        const sync = this.#runSync({
            chainId,
            seedId,
            generation,
            initialSyncDone,
            initialRead
        }).finally(() => {
            // A lock clears the queue, so what is under this key may already be a newer sync
            if (this.#syncQueue[seedId]?.[chainId] !== sync)
                return;
            delete this.#syncQueue[seedId][chainId];
            if (!Object.keys(this.#syncQueue[seedId]).length)
                delete this.#syncQueue[seedId];
        });
        this.#syncQueue[seedId] = { ...this.#syncQueue[seedId], [chainId]: sync };
        return sync;
    }
    hasPhraseDerivedState() {
        return !!Object.keys(this.#syncQueue).length || !!Object.keys(this.#accountStates).length;
    }
    forgetSeed(seedId) {
        delete this.#syncQueue[seedId];
        delete this.#accountStates[seedId];
        delete this.#syncEpochs[seedId];
    }
    /** Keeps what is known of each chain's shared state - see `InitialChainSync`. */
    clear() {
        this.#syncQueue = {};
        this.#accountStates = {};
        this.#syncEpochs = {};
    }
    /**
     * Reads a chain's notes for an account. The chain's first sync on this run gets `initialRead`
     * and settles it once the shared state is on this device; every other sync waits for that on
     * `initialSyncDone`. Never rejects.
     */
    async #runSync({ chainId, seedId, generation, initialSyncDone, initialRead }) {
        let isChainCold = false;
        try {
            if (initialSyncDone) {
                // Rejects when that read failed, which fails this sync too
                await initialSyncDone;
                // Locked while this waited
                if (!this.#ctx.lock.isCurrent(generation))
                    return;
            }
            const config = (0, privacyPools_1.getPrivacyPoolsChainConfig)(BigInt(chainId));
            isChainCold = !!config && (await this.#registry.isChainCold(config));
            // Already on this device, so the chain's other syncs need not wait
            if (!isChainCold)
                initialRead?.resolve();
            // The chain's first read takes minutes, whichever account triggers it. An account new to an
            // already read chain only reads the new blocks.
            const startedAt = Date.now();
            this.#writeInitialChainSync(chainId, { isDone: !isChainCold });
            this.#writeAccountState(seedId, chainId, generation, { syncStartedAt: startedAt });
            this.#ctx.emitUpdate();
            const protocol = await this.#registry.getProtocol(chainId, seedId);
            // Optional on the plugin interface; checked so an SDK that drops it fails clearly
            if (!protocol.notes)
                throw new Error('privacyPools: plugin does not expose notes');
            // The plugin syncs before every read, costing seconds even with no new blocks, so a
            // `sync()` first would pay twice
            const notes = await protocol.notes();
            // The plugin has persisted the shared state by now
            initialRead?.resolve();
            const syncDuration = Date.now() - startedAt;
            // Even if locked since: the shared state is the chain's, not the phrase's
            if (isChainCold)
                this.#writeInitialChainSync(chainId, { isDone: true, durationMs: syncDuration });
            // Nothing derived from the phrase is written back after a lock or account removal
            const isWritten = this.#writeAccountState(seedId, chainId, generation, {
                syncStatus: 'ready',
                syncStartedAt: null,
                error: null,
                lastSyncedAt: Date.now(),
                lastSyncDuration: syncDuration,
                notes: notes.map((note) => ({
                    label: note.label,
                    tokenAddress: (0, privacyPools_1.fromPrivacyPoolsAssetAddress)(note.assetAddress),
                    amount: note.balance,
                    approval: note.approved ? 'approved' : 'pending'
                }))
            });
            if (!isWritten)
                return;
            // A deposit may have landed, which moves the next one's precommitment on
            this.#syncEpochs[seedId] = {
                ...this.#syncEpochs[seedId],
                [chainId]: this.getEpoch(chainId, seedId) + 1
            };
            this.#registry.markChainSynced(chainId, seedId);
        }
        catch (error) {
            // Still not on this device: the next sync reads it again
            if (initialRead && isChainCold) {
                this.#writeInitialChainSync(chainId, { whenDone: undefined });
                initialRead.reject(error);
            }
            if (!this.#ctx.lock.isCurrent(generation))
                return;
            this.#ctx.emitError({
                message: 'Could not load your Privacy Pools balance. Please try again.',
                level: 'silent',
                error: error instanceof Error ? error : new Error('privacyPools: sync failed')
            });
            this.#writeAccountState(seedId, chainId, generation, {
                syncStatus: 'idle',
                syncStartedAt: null,
                error: 'Could not load your Privacy Pools balance on this network. Please try again.'
            });
        }
        finally {
            // Settled on every path, as the chain's other syncs wait for it. A no-op once settled.
            initialRead?.resolve();
            this.#ctx.emitUpdate();
        }
    }
    #writeInitialChainSync(chainId, update) {
        this.#initialChainSyncs[chainId] = {
            ...(this.#initialChainSyncs[chainId] || { isDone: null, durationMs: null }),
            ...update
        };
    }
    /**
     * The only writer of `#accountStates`. Writes nothing after a lock, or once the account is
     * removed, as nothing derived from its phrase may outlive either. Returns whether it wrote.
     */
    #writeAccountState(seedId, chainId, generation, update) {
        if (!this.#ctx.lock.isCurrent(generation) || !this.#ctx.hasAccount(seedId))
            return false;
        const accountChains = this.#accountStates[seedId] || {};
        this.#accountStates[seedId] = {
            ...accountChains,
            [chainId]: { ...(accountChains[chainId] || IDLE_ACCOUNT_CHAIN_STATE), ...update }
        };
        return true;
    }
}
exports.PrivacyPoolsSync = PrivacyPoolsSync;
//# sourceMappingURL=sync.js.map