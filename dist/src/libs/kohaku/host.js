"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createKohakuProvider = exports.createKohakuNetwork = exports.createKohakuKeystore = exports.createKohakuStorage = void 0;
/**
 * Adapters for the `Host` every `@kohaku-eth/*` plugin binds against. Keep them protocol-agnostic;
 * protocol-specific code belongs in that protocol's lib.
 */
/**
 * Backs a plugin's key-value storage with one cached blob in the wallet's store, since
 * `StorageProps` is a closed map and plugins invent keys at runtime.
 *
 * Writes are awaited, not debounced: Privacy Pools persists once per sync, and a lost write would
 * cost a full rescan.
 */
const createKohakuStorage = ({ storage, storageKey, onError }) => {
    let cache = null;
    let hydratePromise = null;
    // Serializes writes: two chains can finish syncing at once, and `storage.set` must not overlap
    let writeQueue = Promise.resolve();
    const hydrate = () => {
        if (cache)
            return Promise.resolve(cache);
        if (!hydratePromise) {
            hydratePromise = storage
                .get(storageKey, {})
                .then((blob) => {
                // A concurrent hydrate may have set it already - keep that object, as writes mutate it
                cache = cache || blob;
                return cache;
            })
                .catch((error) => {
                // Cleared so the next caller retries, or one transient failure would poison every call
                hydratePromise = null;
                throw error;
            });
        }
        return hydratePromise;
    };
    return {
        _brand: 'Storage',
        async get(key) {
            const blob = await hydrate();
            return blob[key] ?? null;
        },
        async set(key, value) {
            const blob = await hydrate();
            // The SDK re-saves its whole store every sync; skip rewriting a multi-MB blob when unchanged
            if (blob[key] === value)
                return;
            blob[key] = value;
            writeQueue = writeQueue
                .then(() => storage.set(storageKey, blob))
                .catch((error) => onError(error, 'Privacy Pools could not save its progress on this device.'));
            await writeQueue;
        }
    };
};
exports.createKohakuStorage = createKohakuStorage;
/**
 * Derives plugin keys without giving the plugin the recovery phrase, unlike the SDK's
 * `MnemonicKeystore`. `deriveKey` must whitelist its paths - see
 * `KeystoreController.derivePrivacyPoolsKey`.
 *
 * Cached because the SDK asks for its signing key on every note it signs, and each derivation is a
 * pbkdf2 over the seed. Cached as a promise, so chains syncing at once share one derivation, and
 * dropped on failure, so the next call retries. Dropped with the instance, so a lock or seed
 * change clears it.
 */
const createKohakuKeystore = (deriveKey) => {
    const cache = new Map();
    return {
        deriveAt(path) {
            const cached = cache.get(path);
            if (cached)
                return cached;
            const key = deriveKey(path).catch((error) => {
                if (cache.get(path) === key)
                    cache.delete(path);
                throw error;
            });
            cache.set(path, key);
            return key;
        }
    };
};
exports.createKohakuKeystore = createKohakuKeystore;
/** Gives plugins the app's own fetch, so platform wiring and interception stay in one place. */
const createKohakuNetwork = (fetch) => ({
    fetch: (input, init) => fetch(input, init)
});
exports.createKohakuNetwork = createKohakuNetwork;
/**
 * Adapts an ethers `JsonRpcProvider` to the plugins' `EthereumProvider`. Reimplements
 * `@kohaku-eth/provider/ethers`, which the app's `moduleResolution: "node"` cannot resolve.
 */
const createKohakuProvider = (provider) => ({
    _internal: provider,
    getChainId: async () => (await provider.getNetwork()).chainId,
    async getLogs(filter) {
        const logs = await provider.getLogs({
            address: filter.address,
            topics: filter.topics,
            fromBlock: filter.fromBlock === undefined ? undefined : Number(filter.fromBlock),
            toBlock: filter.toBlock === undefined ? undefined : Number(filter.toBlock)
        });
        return logs.map((log) => ({
            blockNumber: BigInt(log.blockNumber),
            topics: [...log.topics],
            data: log.data,
            address: log.address,
            logIndex: log.index
        }));
    },
    getBlockNumber: async () => BigInt(await provider.getBlockNumber()),
    async waitForTransaction(txHash) {
        await provider.waitForTransaction(txHash);
    },
    getBalance: (address) => provider.getBalance(address),
    getCode: (address) => provider.getCode(address),
    async getTransactionReceipt(txHash) {
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt)
            return null;
        return {
            blockNumber: BigInt(receipt.blockNumber),
            status: BigInt(receipt.status ?? 0),
            gasUsed: receipt.gasUsed,
            logs: receipt.logs.map((log) => ({
                blockNumber: BigInt(log.blockNumber),
                topics: [...log.topics],
                data: log.data,
                address: log.address,
                logIndex: log.index
            }))
        };
    },
    request: ({ method, params }) => provider.send(method, params ?? []),
    call: async (call) => (await provider.call({
        to: call.to,
        from: call.from,
        data: call.input,
        value: call.value === undefined ? undefined : BigInt(call.value)
    })),
    estimateGas: (call) => provider.estimateGas({
        to: call.to,
        from: call.from,
        data: call.input,
        value: call.value === undefined ? undefined : BigInt(call.value)
    }),
    getGasPrice: async () => (await provider.getFeeData()).gasPrice ?? 0n,
    getTransactionCount: (address, block) => provider.getTransactionCount(address, block)
});
exports.createKohakuProvider = createKohakuProvider;
//# sourceMappingURL=host.js.map