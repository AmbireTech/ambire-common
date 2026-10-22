"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Erc7730Controller = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const safe_1 = require("../../consts/safe");
const registry_1 = require("../../libs/humanizer/erc7730/registry");
const types_1 = require("../../libs/humanizer/erc7730/types");
const consts_1 = require("../../libs/humanizer/erc7730/consts");
const fetch_1 = require("../../libs/humanizer/erc7730/fetch");
const utils_1 = require("../../libs/humanizer/erc7730/utils");
const with_timeout_1 = require("../../utils/with-timeout");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
// One flat store keyed by strings, so the persisted descriptors are the entries under this prefix
const DESCRIPTOR_KEY_PREFIX = 'descriptor:';
const SINGLETON_KEY_PREFIX = 'safeSingleton:';
/** Every kind of entry in the flat cache, so each key format is written in exactly one place. */
const cacheKey = {
    calldataIndex: 'calldataIndex',
    eip712Index: 'eip712Index',
    descriptor: (relayerPath) => `${DESCRIPTOR_KEY_PREFIX}${relayerPath}`,
    safeSingleton: (chainId, address) => `${SINGLETON_KEY_PREFIX}${(0, utils_1.getSafeSingletonKey)(chainId, address)}`
};
const EMPTY_PERSISTED_CACHE = {
    calldataIndex: null,
    eip712Index: null,
    descriptors: {}
};
/**
 * Owns ERC-7730 "clear signing" descriptors: fetching them, caching them, and keeping that cache in
 * storage so it survives a service worker restart. The only writer of the `erc7730RegistryCache`
 * storage key.
 *
 * The library in `libs/humanizer/erc7730` is entirely synchronous and performs no I/O. It reports
 * what it is *missing* as `Erc7730Want`s; this controller answers them and asks again, until
 * nothing is missing. Each round is one parallel batch, and each nesting level takes one round.
 *
 * So everything external - the relayer, the RPC reads for Safe proxies, the cache, the request
 * dedup and the persistence - lives here.
 */
class Erc7730Controller extends eventEmitter_1.default {
    #storage;
    #callRelayer;
    #featureFlags;
    #ui;
    /** Reads a Safe proxy's singleton slot; undefined where no RPC access is available. */
    #providers;
    #persisting = false;
    #persistScheduled = false;
    // Bumped on every cache write, so a run served entirely from cache doesn't rewrite an identical
    // blob; `#persistedRevision` is the revision the last write was taken at.
    #revision = 0;
    #persistedRevision = 0;
    #entries = new Map();
    #inFlight = new Map();
    // Private, so it stays out of the controller state serialized to the UI on every update
    #initialLoadPromise;
    constructor({ storage, callRelayer, featureFlags, providers, ui, eventEmitterRegistry }) {
        super(eventEmitterRegistry);
        this.#storage = storage;
        this.#callRelayer = callRelayer;
        this.#featureFlags = featureFlags;
        this.#ui = ui;
        this.#providers = providers;
        this.#initialLoadPromise = this.#load();
    }
    async #load() {
        // Providers are constructed after their networks load, so a lookup here before that settles
        // would find nothing and permanently record a Safe as having no singleton.
        await this.#providers?.initialLoadPromise;
        try {
            const persisted = await this.#storage.get('erc7730RegistryCache', EMPTY_PERSISTED_CACHE);
            // Entries past their TTL are dropped rather than kept and re-checked on every lookup, which
            // is also what keeps the stored blob from growing without bound.
            this.#hydrate(cacheKey.calldataIndex, persisted.calldataIndex, consts_1.ERC7730_CACHE_TTL_MS);
            this.#hydrate(cacheKey.eip712Index, persisted.eip712Index, consts_1.ERC7730_CACHE_TTL_MS);
            Object.entries(persisted.descriptors).forEach(([path, entry]) => {
                this.#hydrate(cacheKey.descriptor(path), entry, consts_1.ERC7730_CACHE_TTL_MS);
            });
        }
        catch (error) {
            this.emitError({
                message: 'Something went wrong while loading saved transaction details. Transactions will still be readable, they may just take a moment longer to describe.',
                level: 'silent',
                error
            });
        }
        this.#persistedRevision = this.#revision;
        // After the baseline is recorded, so a blob that is already over the cap - an earlier build's,
        // or one written before the cap was lowered - is trimmed by the next write
        this.#evictDescriptorsOverCap();
    }
    /**
     * Writes the whole in-memory cache under its storage key. Always a full write, never a
     * read-modify-write, so concurrent descriptor fetches can't drop each other's entries. Awaits a
     * running write, skips intermediate ones and queues only the last, the same way
     * `DomainsController` persists its own cache.
     */
    async #persist() {
        const revision = this.#revision;
        if (revision === this.#persistedRevision)
            return;
        if (this.#persisting) {
            this.#persistScheduled = true;
            return;
        }
        this.#persisting = true;
        try {
            await this.#storage.set('erc7730RegistryCache', {
                calldataIndex: this.#entryFor(cacheKey.calldataIndex),
                eip712Index: this.#entryFor(cacheKey.eip712Index),
                descriptors: this.#descriptorEntries()
            });
            // Recorded only once the write lands, so a failed one is retried by the next persist
            // instead of being taken for done
            this.#persistedRevision = revision;
        }
        catch (error) {
            this.emitError({
                message: 'Something went wrong while saving transaction details for later. Transactions will still be readable, they may just take a moment longer to describe.',
                level: 'silent',
                error
            });
        }
        finally {
            this.#persisting = false;
            if (this.#persistScheduled) {
                this.#persistScheduled = false;
                void this.#persist();
            }
        }
    }
    //
    // Answering wants. Each fetch is cached and deduped, so a want repeated across rounds or across
    // calls costs at most one request.
    //
    /**
     * One cached, deduped fetch. Nothing may await between finding no in-flight request and storing
     * this one, or concurrent callers all miss that check and each fires a request - which is what
     * would make an accountOp with ten calls fetch the one shared index ten times.
     */
    async #cached(key, ttlMs, fetcher) {
        const cached = this.#entries.get(key);
        if (cached && Date.now() - cached.fetchedAt < ttlMs) {
            // Re-inserting moves the entry to the back of the map, which is what makes the eviction below
            // least-recently-used rather than oldest-fetched
            this.#entries.delete(key);
            this.#entries.set(key, cached);
            return cached.value;
        }
        const pending = this.#inFlight.get(key);
        if (pending)
            return pending;
        const promise = fetcher()
            .then((value) => {
            this.#entries.set(key, { value, fetchedAt: Date.now() });
            this.#revision += 1;
            this.#evictDescriptorsOverCap();
            return value;
        })
            .catch((error) => {
            // A refetch that fails leaves the stale value in place rather than losing it
            if (cached)
                return cached.value;
            throw error;
        })
            .finally(() => {
            this.#inFlight.delete(key);
        });
        this.#inFlight.set(key, promise);
        return promise;
    }
    /**
     * Drops the least recently used descriptors once there are more than the cap.
     *
     * The TTL alone does not bound this: someone who interacts with many contracts inside one TTL
     * window would grow both this map and the persisted blob without limit, and the whole blob is
     * rewritten on every newly fetched descriptor.
     */
    #evictDescriptorsOverCap() {
        const descriptorKeys = [...this.#entries.keys()].filter((key) => key.startsWith(DESCRIPTOR_KEY_PREFIX));
        if (descriptorKeys.length <= consts_1.ERC7730_MAX_CACHED_DESCRIPTORS)
            return;
        descriptorKeys
            .slice(0, descriptorKeys.length - consts_1.ERC7730_MAX_CACHED_DESCRIPTORS)
            .forEach((key) => this.#entries.delete(key));
        this.#revision += 1;
    }
    /** Seeds one entry from storage, ignoring anything already past its TTL. */
    #hydrate(key, entry, ttlMs) {
        if (entry && Date.now() - entry.fetchedAt < ttlMs)
            this.#entries.set(key, entry);
    }
    #entryFor(key) {
        return this.#entries.get(key) ?? null;
    }
    #descriptorEntries() {
        const descriptors = {};
        this.#entries.forEach((entry, key) => {
            if (key.startsWith(DESCRIPTOR_KEY_PREFIX)) {
                descriptors[key.slice(DESCRIPTOR_KEY_PREFIX.length)] =
                    entry;
            }
        });
        return descriptors;
    }
    #getCalldataIndex() {
        return this.#cached(cacheKey.calldataIndex, consts_1.ERC7730_CACHE_TTL_MS, () => (0, fetch_1.fetchRelayerResource)(consts_1.ERC7730_CALLDATA_INDEX_RELAYER_PATH, 'GET', this.#callRelayer, registry_1.validateCalldataIndex));
    }
    #getEip712Index() {
        return this.#cached(cacheKey.eip712Index, consts_1.ERC7730_CACHE_TTL_MS, () => (0, fetch_1.fetchRelayerResource)(consts_1.ERC7730_EIP712_INDEX_RELAYER_PATH, 'GET', this.#callRelayer, registry_1.validateEip712Index));
    }
    /** Paths reach here as the registry wrote them; normalizing keeps one cache entry per file. */
    #getDescriptor(pathOrUrl) {
        const relayerPath = (0, registry_1.normalizeRelayerPath)(pathOrUrl);
        return this.#cached(cacheKey.descriptor(relayerPath), consts_1.ERC7730_CACHE_TTL_MS, () => (0, fetch_1.fetchRelayerResource)(consts_1.ERC7730_DESCRIPTOR_PATH, 'POST', this.#callRelayer, registry_1.validateDescriptor, { descriptorPath: relayerPath }));
    }
    async #getSafeSingleton(chainId, safeAddress) {
        const provider = this.#providers?.providers[chainId.toString()];
        if (!provider)
            return null;
        try {
            return await this.#cached(cacheKey.safeSingleton(chainId, safeAddress), consts_1.SAFE_SINGLETON_CACHE_TTL_MS, async () => {
                const [code, slotValue] = await (0, with_timeout_1.withTimeout)(() => Promise.all([
                    provider.getCode(safeAddress),
                    provider.getStorage(safeAddress, consts_1.SAFE_PROXY_SINGLETON_SLOT)
                ]), {
                    timeoutMs: consts_1.ERC7730_DESCRIPTOR_WAIT_MS,
                    message: `Timed out fetching Safe singleton: ${safeAddress}`
                });
                // Any contract can put a registered address in slot 0 to borrow its descriptor, but only
                // a real SafeProxy forwards its calls to that address
                if (!safe_1.KNOWN_SAFE_PROXY_CODE_HASHES.has((0, ethers_1.keccak256)(code)))
                    return null;
                const singleton = (0, registry_1.getAddressFromStorageSlot)(slotValue);
                if (!singleton || !safe_1.KNOWN_SAFE_SINGLETONS.has(singleton.toLowerCase()))
                    return null;
                return singleton;
            });
        }
        catch (error) {
            this.emitError({
                message: `Something went wrong while reading the details of the Safe account ${safeAddress}. Its transactions will still be readable, just with less detail.`,
                level: 'silent',
                error
            });
            return null;
        }
    }
    //
    // Descriptor lookups
    //
    /**
     * Answers one want, always recording something - a value, or a negative - so the planner stops
     * asking for it. A relayer or RPC failure is recorded as a negative rather than thrown, so one
     * unavailable descriptor degrades to the built-in humanization instead of losing the whole op.
     */
    async #answer(want, known) {
        try {
            await this.#fetchWant(want, known);
        }
        catch (error) {
            this.emitError({
                message: 'Some transaction details could not be loaded. The transaction will still be readable, just with less detail.',
                level: 'silent',
                error
            });
            this.#recordUnavailable(want, known);
        }
    }
    #recordUnavailable(want, known) {
        switch (want.kind) {
            case 'safeSingleton':
                known.safeSingletons[(0, utils_1.getSafeSingletonKey)(want.chainId, want.address)] = null;
                break;
            case 'includedDescriptor':
                known.descriptorsByPath[want.path] = null;
                break;
            case 'contractDescriptor':
                known.contractDescriptors[(0, utils_1.getRegistryKey)(want.chainId, want.address)] = null;
                break;
            case 'eip712Descriptor': {
                const registryKey = (0, utils_1.getRegistryKey)(want.chainId, want.verifyingContract);
                known.eip712Descriptors[`${registryKey}:${want.primaryType}`] = null;
                break;
            }
            default: {
                // A new want kind that records nothing here would be re-asked on every round and then
                // silently dropped, so this makes adding one a compile error instead
                const unhandled = want;
                throw new Error(`Unhandled ERC-7730 want: ${JSON.stringify(unhandled)}`);
            }
        }
    }
    async #fetchWant(want, known) {
        if (want.kind === 'safeSingleton') {
            const singleton = await this.#getSafeSingleton(want.chainId, want.address);
            known.safeSingletons[(0, utils_1.getSafeSingletonKey)(want.chainId, want.address)] = singleton;
            return;
        }
        if (want.kind === 'includedDescriptor') {
            known.descriptorsByPath[want.path] = await this.#getDescriptor(want.path);
            return;
        }
        if (want.kind === 'contractDescriptor') {
            const key = (0, utils_1.getRegistryKey)(want.chainId, want.address);
            const index = await this.#getCalldataIndex();
            const path = index[key];
            if (!path) {
                known.contractDescriptors[key] = null;
                return;
            }
            known.contractDescriptors[key] = { path };
            known.descriptorsByPath[path] = await this.#getDescriptor(path);
            return;
        }
        const registryKey = (0, utils_1.getRegistryKey)(want.chainId, want.verifyingContract);
        const key = `${registryKey}:${want.primaryType}`;
        const index = await this.#getEip712Index();
        const entries = index[registryKey]?.[want.primaryType];
        const entry = entries?.length ? (0, registry_1.selectEip712IndexEntry)(entries, want.encodeTypeHash) : null;
        if (!entry) {
            known.eip712Descriptors[key] = null;
            return;
        }
        known.eip712Descriptors[key] = { path: entry.path };
        known.descriptorsByPath[entry.path] = await this.#getDescriptor(entry.path);
    }
    /**
     * Asks the library what it is missing, fetches that batch, and asks again - until it wants
     * nothing more. Each round uncovers the next nesting level, and terminates because nested
     * calldata is strictly shorter than its parent; the depth cap is a backstop.
     */
    async #gather(plan) {
        await this.#initialLoadPromise;
        const known = {
            contractDescriptors: { ...types_1.EMPTY_ERC7730_KNOWN.contractDescriptors },
            eip712Descriptors: { ...types_1.EMPTY_ERC7730_KNOWN.eip712Descriptors },
            descriptorsByPath: { ...types_1.EMPTY_ERC7730_KNOWN.descriptorsByPath },
            safeSingletons: { ...types_1.EMPTY_ERC7730_KNOWN.safeSingletons }
        };
        for (let round = 0; round < registry_1.ERC7730_MAX_RESOLUTION_DEPTH; round++) {
            const wants = plan(known);
            if (!wants.length)
                break;
            await Promise.all(wants.map((want) => this.#answer(want, known)));
        }
        void this.#persist();
        return known;
    }
    async getDescriptorsForAccountOp(accountOp) {
        await this.#featureFlags.initialLoadPromise;
        if (!this.#featureFlags.isFeatureEnabled('clearSigning'))
            return {};
        try {
            const known = await this.#gather((state) => (0, registry_1.planErc7730Wants)(accountOp, state));
            return (0, registry_1.resolveErc7730Descriptors)(accountOp, known);
        }
        catch (error) {
            this.emitError({
                message: 'Some transaction details could not be loaded. The transaction will still be readable, just with less detail.',
                level: 'silent',
                error
            });
            // Nothing usable was fetched, but built-in descriptors need no fetching at all
            return (0, registry_1.resolveErc7730Descriptors)(accountOp, types_1.EMPTY_ERC7730_KNOWN);
        }
    }
    async getDescriptorForMessage(message) {
        await this.#featureFlags.initialLoadPromise;
        if (!this.#featureFlags.isFeatureEnabled('clearSigning'))
            return null;
        try {
            const known = await this.#gather((state) => (0, registry_1.planErc7730MessageWants)(message, state));
            return (0, registry_1.resolveErc7730MessageDescriptor)(message, known);
        }
        catch (error) {
            this.emitError({
                message: 'Some details of this message could not be loaded. The message will still be readable, just with less detail.',
                level: 'silent',
                error
            });
            return null;
        }
    }
    /**
     * The UI-facing counterpart of `getDescriptorsForAccountOp`, for screens that humanize an
     * accountOp themselves (transaction history, Benzin). Replies to the awaiting `dispatchAndWait`
     * rather than returning, since the UI and this controller are separate contexts in the extension.
     */
    async resolveDescriptorsForAccountOp(accountOp, requestId) {
        try {
            const descriptors = await this.getDescriptorsForAccountOp(accountOp);
            this.#ui.message.sendUiMessage({ requestId, ok: true, res: descriptors });
        }
        catch (error) {
            this.#ui.message.sendUiMessage({
                requestId,
                ok: false,
                error: error?.message || 'Failed to resolve the transaction details'
            });
        }
    }
}
exports.Erc7730Controller = Erc7730Controller;
//# sourceMappingURL=erc7730.js.map