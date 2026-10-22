"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrivacyPoolsProtocolRegistry = void 0;
const privacy_pools_1 = require("@kohaku-eth/privacy-pools");
const privacyPools_1 = require("../../consts/privacyPools");
const host_1 = require("../../libs/kohaku/host");
const dataService_1 = require("../../libs/privacyPools/dataService");
const context_1 = require("./context");
const toEntryKey = (chainId, seedId) => `${chainId}:${seedId}`;
/**
 * Starts a cold chain's entrypoint walk at its deployment block instead of block zero (22M blocks
 * of `eth_getLogs` before the first event). Pools are left empty, so they are read in full.
 */
const resolveInitialState = async () => privacyPools_1.PRIVACY_POOLS_SUPPORTED_CHAIN_IDS.reduce((state, chainId) => {
    const config = (0, privacyPools_1.getPrivacyPoolsChainConfig)(chainId);
    if (!config)
        return state;
    return {
        ...state,
        [(0, privacyPools_1.getPrivacyPoolsStoreKey)(config)]: {
            sync: { lastSyncedBlock: `0x${config.deploymentBlock.toString(16)}` }
        }
    };
}, {});
/** The Privacy Pools plugins, one per chain and recovery phrase, and what they are built from. */
class PrivacyPoolsProtocolRegistry {
    #ctx;
    #proverFactory;
    /** Per `${chainId}:${seedId}`. */
    #entries = new Map();
    /** Per phrase, outliving its plugins, so a rebuilt plugin skips re-deriving keys (pbkdf2). */
    #kohakuKeystores = new Map();
    /**
     * Bumped whenever a sync persists a chain's history. A plugin reads the store only when built, so
     * an older one would re-read blocks another phrase's sync already read. See `getProtocol`. Kept
     * through a lock: none of it comes from a phrase.
     */
    #chainVersions = new Map();
    constructor(ctx, proverFactory) {
        this.#ctx = ctx;
        this.#proverFactory = proverFactory;
    }
    getHost(chainId, seedId) {
        return this.#createHost((0, context_1.getChainProvider)(this.#ctx.providers, chainId), seedId);
    }
    /** Rebuilt when another phrase's sync persisted newer history since, to start from that. */
    async getProtocol(chainId, seedId) {
        const key = toEntryKey(chainId, seedId);
        const chainVersion = this.#chainVersions.get(chainId) || 0;
        const existing = this.#entries.get(key);
        if (existing?.chainVersion === chainVersion)
            return existing.protocol;
        if (existing)
            this.#entries.delete(key);
        const config = (0, context_1.getChainConfig)(chainId);
        const provider = (0, context_1.getChainProvider)(this.#ctx.providers, chainId);
        const host = this.#createHost(provider, seedId);
        const { dataService, isSagaHydrated } = await this.#getDataService(config, host.provider);
        const protocol = new privacy_pools_1.PrivacyPoolsV1Protocol(host, {
            accountIndex: privacyPools_1.PRIVACY_POOLS_ACCOUNT_INDEX,
            // Pinned rather than the SDK's default: the schemes derive different notes, so a default that
            // changes in a bump would hide every note made before it
            secretManager: privacy_pools_1.SignatureSecretManager,
            // Skipped once this chain has a persisted store
            initialState: resolveInitialState,
            dataService,
            entrypoint: {
                address: BigInt(config.entrypointAddress),
                deploymentBlock: config.deploymentBlock
            },
            // The SDK types it as the circuits package's whole `Prover`, but only ever calls `prove`
            proverFactory: this.#proverFactory,
            // Not the SDK's IPFS default, which needs ipfs.io up and the last root update's CID pinned
            aspServiceFactory: () => new privacy_pools_1.OxBowAspService({ network: host.network, aspUrl: config.aspUrl }),
            // Not the SDK's built-in table: withdrawals are built with the adapters
            // `readPaymasterWithdrawal` checks, and reach the bundler with our key. Empty without a
            // paymaster, so the SDK refuses rather than falls back to its table.
            paymasterConfig: config.paymaster
                ? {
                    [Number(config.chainId)]: {
                        bundlerUrl: (0, privacyPools_1.getPrivacyPoolsBundlerUrl)(config.chainId),
                        entryPointAddress: config.paymaster.entryPointAddress,
                        paymasterAddress: config.paymaster.paymasterAddress,
                        poolsAccountsMap: config.paymaster.poolAdapters
                    }
                }
                : {}
        });
        this.#entries.set(key, { chainId, seedId, protocol, provider, chainVersion, isSagaHydrated });
        return protocol;
    }
    /** Whether the plugin has stored nothing for this chain yet. */
    async isChainCold(config) {
        try {
            // The shared adapter, not the raw store, so another phrase's in-flight save counts
            return !(await this.#ctx.kohakuStorage.get((0, privacyPools_1.getPrivacyPoolsStoreKey)(config)));
        }
        catch {
            // Treated as cold: reading from the CDN is the cheaper way to be wrong
            return true;
        }
    }
    /**
     * After a sync persisted the chain's history: other phrases' plugins on the chain are now behind
     * the store, while this one is at it. Also drops the plugins that hydrated the chain from the
     * CDN, whose reader would re-download the whole history on every sync. Their replacements start
     * from the persisted store.
     */
    markChainSynced(chainId, seedId) {
        const chainVersion = (this.#chainVersions.get(chainId) || 0) + 1;
        this.#chainVersions.set(chainId, chainVersion);
        const key = toEntryKey(chainId, seedId);
        const syncedEntry = this.#entries.get(key);
        if (syncedEntry)
            this.#entries.set(key, { ...syncedEntry, chainVersion });
        this.#dropWhere((entry) => entry.chainId === chainId && entry.isSagaHydrated);
    }
    /** Drops the plugins built against a provider that has since been replaced. */
    dropStaleProviders() {
        this.#dropWhere((entry) => this.#ctx.providers.providers[entry.chainId] !== entry.provider);
    }
    hasPhraseDerivedState() {
        return !!this.#entries.size || !!this.#kohakuKeystores.size;
    }
    forgetSeed(seedId) {
        this.#dropWhere((entry) => entry.seedId === seedId);
        this.#kohakuKeystores.delete(seedId);
    }
    clear() {
        this.#entries.clear();
        this.#kohakuKeystores.clear();
    }
    #createHost(provider, seedId) {
        return {
            network: (0, host_1.createKohakuNetwork)(this.#ctx.fetch),
            storage: this.#ctx.kohakuStorage,
            keystore: this.#getKohakuKeystore(seedId),
            provider: (0, host_1.createKohakuProvider)(provider)
        };
    }
    #getKohakuKeystore(seedId) {
        const existing = this.#kohakuKeystores.get(seedId);
        if (existing)
            return existing;
        const keystore = (0, host_1.createKohakuKeystore)((path) => this.#ctx.keystore.derivePrivacyPoolsKey(seedId, path));
        this.#kohakuKeystores.set(seedId, keystore);
        return keystore;
    }
    /**
     * The CDN only for a cold chain: its reader replays a pool's whole history on every call,
     * ignoring the start block. A warm chain reads new blocks from the provider. See
     * `markChainSynced`.
     */
    async #getDataService(config, provider) {
        const canUseSaga = !!config.sagaSyncUrl && (await this.isChainCold(config));
        return (0, dataService_1.createPrivacyPoolsDataService)({
            provider,
            ...(canUseSaga
                ? { saga: { sourceUrl: config.sagaSyncUrl, chainId: config.chainId } }
                : {}),
            onSagaUnavailable: (error) => this.#ctx.emitError({
                message: 'Loading your Privacy Pools history is taking the slow route on this network. It will still finish.',
                level: 'silent',
                error: error instanceof Error ? error : new Error('privacyPools: saga hydration unavailable')
            })
        });
    }
    #dropWhere(shouldDrop) {
        this.#entries.forEach((entry, key) => {
            if (shouldDrop(entry))
                this.#entries.delete(key);
        });
    }
}
exports.PrivacyPoolsProtocolRegistry = PrivacyPoolsProtocolRegistry;
//# sourceMappingURL=protocolRegistry.js.map