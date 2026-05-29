"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProvidersController = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const balanceChanges_1 = require("../../libs/accountOp/balanceChanges");
const networks_1 = require("../../libs/networks/networks");
const portfolio_1 = require("../../libs/portfolio");
const provider_1 = require("../../services/provider");
const debugTransaction_1 = require("../../utils/debugTransaction");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const STATUS_WRAPPED_METHODS = {
    toggleBatching: 'INITIAL'
};
const RANDOM_ADDRESS = '0x0000000000000000000000000000000000000001';
/**
 * The ProvidersController manages RPC providers, enabling the extension to communicate with the blockchain.
 * Each network requires an initialized JsonRpcProvider, and the provider must be reinitialized whenever network.selectedRpcUrl changes.
 */
class ProvidersController extends eventEmitter_1.default {
    #storage;
    #getNetworks;
    #sendUiMessage;
    #providers = {};
    #providersProxy;
    #scheduledResolveAssetInfoActions = {};
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    isBatchingEnabled = true;
    statuses = STATUS_WRAPPED_METHODS;
    constructor({ storage, getNetworks, sendUiMessage, eventEmitterRegistry }) {
        super(eventEmitterRegistry);
        this.#storage = storage;
        this.#getNetworks = getNetworks;
        this.#sendUiMessage = sendUiMessage;
        /**
         * Proxy over the providers map that:
         * - Lazily initializes a provider when a chainId is accessed
         * - Removes and destroys providers for networks no longer in allNetworks
         * - Emits updates only when the providers set actually changes
         */
        this.#providersProxy = new Proxy(this.#providers, {
            get: (target, prop, receiver) => {
                try {
                    // Handle only numeric chainIds for temporary providers.
                    // Any other property (e.g. toJSON) is forwarded to the target without triggering proxy logic.
                    if (isNaN(Number(prop)))
                        return Reflect.get(target, prop, receiver);
                    // forwarded to the target without triggering proxy logic while ctrl is still loading.
                    if (!!this.initialLoadPromise)
                        return Reflect.get(target, prop, receiver);
                    if (prop in target) {
                        return Reflect.get(target, prop, receiver);
                    }
                    const chainId = BigInt(prop.toString());
                    const network = getNetworks().find((n) => n.chainId === chainId);
                    if (network)
                        this.#autoInitProvider(chainId);
                }
                catch (error) {
                    console.error(`Failed to auto set provider for chainId: ${prop.toString()}`, error);
                }
                return Reflect.get(target, prop, receiver);
            },
            set: (target, prop, value, receiver) => {
                return Reflect.set(target, prop, value, receiver);
            },
            deleteProperty: (target, prop) => {
                return Reflect.deleteProperty(target, prop);
            },
            has: (target, prop) => {
                return Reflect.has(target, prop);
            },
            ownKeys: (target) => {
                return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor: (target, prop) => {
                return Reflect.getOwnPropertyDescriptor(target, prop);
            }
        });
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    get providers() {
        return this.#providersProxy;
    }
    async #load() {
        const storageIsBatchingEnabled = await this.#storage.get('isBatchingEnabled', this.isBatchingEnabled);
        this.isBatchingEnabled = storageIsBatchingEnabled;
        this.emitUpdate();
    }
    async init({ networks }) {
        await this.initialLoadPromise;
        networks.forEach((n) => this.setProvider(n));
        this.emitUpdate();
    }
    #autoInitProvider(chainId, rpcUrl) {
        const network = this.#getNetworks().find((n) => n.chainId === chainId);
        if (network) {
            this.setProvider(network);
        }
        else if (rpcUrl) {
            this.#providers[chainId.toString()] = (0, provider_1.getRpcProvider)([rpcUrl], chainId, rpcUrl);
        }
        this.emitUpdate();
    }
    setProvider(network, opts) {
        const { forceUpdate = false } = opts || {};
        const stringChainId = network.chainId.toString();
        const provider = this.#providers[stringChainId];
        const isRpcUrlChanged = provider?._getConnection().url !== network.selectedRpcUrl;
        if (!provider || isRpcUrlChanged || forceUpdate) {
            const oldRPC = this.#providers[stringChainId];
            try {
                if (oldRPC)
                    oldRPC.destroy();
            }
            catch (error) {
                if (error?.message !== 'provider destroyed; cancelled request') {
                    this.emitError({ error, message: error.message, level: 'silent', sendCrashReport: true });
                }
            }
            const batchMaxCount = this.isBatchingEnabled
                ? (0, networks_1.getProviderBatchMaxCount)(network, network.selectedRpcUrl)
                : 1;
            this.#providers[stringChainId] = (0, provider_1.getRpcProvider)(network.rpcUrls, network.chainId, network.selectedRpcUrl, {
                batchMaxCount,
                batchMaxSize: network.rpcNoStateOverride ? 24576 : undefined
            });
            this.#providers[stringChainId].isWorking = true;
            this.#providers[stringChainId].batchMaxCount = batchMaxCount;
        }
    }
    updateProviderIsWorking(chainId, isWorking) {
        const provider = this.providers[chainId.toString()];
        if (!provider)
            return;
        if (provider.isWorking === isWorking)
            return;
        provider.isWorking = isWorking;
        this.emitUpdate();
    }
    removeProvider(chainId) {
        if (!this.#providers[chainId.toString()])
            return;
        this.#providers[chainId.toString()]?.destroy();
        delete this.#providers[chainId.toString()];
        this.emitUpdate();
    }
    toggleBatching() {
        return this.withStatus('toggleBatching', async () => {
            this.isBatchingEnabled = !this.isBatchingEnabled;
            await this.#storage.set('isBatchingEnabled', this.isBatchingEnabled);
            this.#getNetworks().forEach((n) => this.setProvider(n, { forceUpdate: true }));
            this.emitUpdate();
        });
    }
    async useTempProvider({ rpcUrl, chainId }, callback) {
        const network = this.#getNetworks().find((n) => n.chainId === chainId);
        const batchMaxCount = this.isBatchingEnabled && network
            ? (0, networks_1.getProviderBatchMaxCount)(network, network.selectedRpcUrl)
            : 1;
        const provider = (0, provider_1.getRpcProvider)([rpcUrl], chainId, rpcUrl, {
            batchMaxCount,
            batchMaxSize: network?.rpcNoStateOverride ? 24576 : undefined
        });
        provider.isWorking = true;
        provider.batchMaxCount = batchMaxCount;
        await callback(provider);
        try {
            provider.destroy();
        }
        catch (error) {
            // Ignore errors — the provider have already been destroyed inside the callback.
        }
    }
    async callProviderAndSendResToUi({ chainId, method, args }, requestId) {
        const provider = this.providers[chainId.toString()];
        if (!provider) {
            this.emitError({
                error: new Error('callProviderAndSendResToUi: provider not found'),
                message: 'Provider not found',
                level: 'silent'
            });
            return this.#sendUiMessage({
                requestId,
                ok: false,
                error: 'Provider not found'
            });
        }
        const fn = provider[method];
        if (typeof fn !== 'function') {
            this.emitError({
                error: new Error('callProviderAndSendResToUi: not a valid provider method'),
                message: `${method} is not a valid JsonRpcProvider method`,
                level: 'silent'
            });
            return this.#sendUiMessage({
                requestId,
                ok: false,
                error: `${method} is not a valid JsonRpcProvider method`
            });
        }
        try {
            const result = await fn.apply(provider, args);
            this.#sendUiMessage({
                requestId,
                ok: true,
                res: result
            });
        }
        catch (error) {
            this.emitError({ error, message: error.message, level: 'major' });
            this.#sendUiMessage({
                requestId,
                ok: false,
                error: error.message
            });
        }
    }
    async callContractAndSendResToUi({ chainId, address, abi, method, args }, requestId) {
        const network = this.#getNetworks().find((n) => n.chainId === chainId);
        if (!network) {
            this.emitError({
                error: new Error('callContractAndSendResToUi: network not found'),
                message: `Network with chainId: ${chainId} not found`,
                level: 'silent'
            });
            return this.#sendUiMessage({
                requestId,
                ok: false,
                error: `Network with chainId: ${chainId} not found`
            });
        }
        const provider = this.providers[network.chainId.toString()];
        const contract = new ethers_1.Contract(address, [abi], provider);
        let error = undefined;
        if (typeof contract[method] !== 'function') {
            this.emitError({
                error: new Error('callContractAndSendResToUi: not a valid Contract method'),
                message: `${method.toString()} is not a valid Contract method`,
                level: 'silent'
            });
            return this.#sendUiMessage({
                requestId,
                ok: false,
                error: `${method.toString()} is not a valid Contract method`
            });
        }
        const result = await contract[method].apply(contract, args);
        this.#sendUiMessage({
            requestId,
            ok: !!result,
            res: result ?? undefined,
            error: error?.message ?? undefined
        });
    }
    /**
     * Use this to communicate balanche changes for a transaction
     * to the external benzin
     */
    async getTokenBalancesOnBlockAndSendResToUi({ accountId, chainId, tokenAddrs, blockTag, accountAddr, receipts }, requestId) {
        const network = this.#getNetworks().find((n) => n.chainId === chainId);
        if (!network) {
            return this.#sendUiMessage({
                requestId,
                ok: false,
                error: `Network with chainId: ${chainId} not found`
            });
        }
        const provider = this.providers[network.chainId.toString()];
        if (!provider) {
            return this.#sendUiMessage({
                requestId,
                ok: false,
                error: `Provider for chainId: ${chainId} not found`
            });
        }
        try {
            const portfolio = new portfolio_1.Portfolio(fetch, provider, network);
            // create a wrapper function so that we could pass it correctly
            // to the required type for getAccountOpBalanceChanges.
            // the final goal is just calling portfolio.getTokensByAddresses
            const getTokenBalancesOnBlock = (portfolioAccountId, _chainId, portfolioTokenAddrs, portfolioBlockTag, portfolioAccountAddr) => portfolio.getTokensByAddresses(portfolioAccountAddr || portfolioAccountId, portfolioTokenAddrs, { blockTag: portfolioBlockTag });
            const result = await (0, balanceChanges_1.getAccountOpBalanceChanges)({
                accountAddr: accountAddr || accountId,
                chainId,
                tokenAddrs,
                receiptBlockNumber: blockTag,
                getTokenBalancesOnBlock,
                receipts,
                debugTraceTransaction: (0, debugTransaction_1.getDebugTraceTransaction)(chainId, provider)
            });
            return this.#sendUiMessage({
                requestId,
                ok: true,
                res: result
            });
        }
        catch (error) {
            return this.#sendUiMessage({
                requestId,
                ok: false,
                error: error?.message || 'Failed to get token balances on block'
            });
        }
    }
    async #executeBatchedFetch(network) {
        const allAddresses = Array.from(new Set(this.#scheduledResolveAssetInfoActions[network.chainId.toString()]?.data.map((i) => i.address))) || [];
        const portfolio = new portfolio_1.Portfolio(fetch, this.providers[network.chainId.toString()], network);
        const options = {
            disableAutoDiscovery: true,
            additionalErc20Hints: allAddresses,
            additionalErc721Hints: Object.fromEntries(allAddresses.map((i) => [i, [1n]]))
        };
        const portfolioResponse = await portfolio.get(RANDOM_ADDRESS, options);
        this.#scheduledResolveAssetInfoActions[network.chainId.toString()]?.data.forEach((i) => {
            const tokenInfo = (i.address,
                portfolioResponse.tokens.find((t) => t.address.toLocaleLowerCase() === i.address.toLowerCase()));
            const nftInfo = (i.address,
                portfolioResponse.collections.find((t) => t.address.toLocaleLowerCase() === i.address.toLowerCase()));
            i.callback({ tokenInfo, nftInfo });
        });
    }
    /**
     * Resolves symbol and decimals for tokens or name for nfts.
     */
    async resolveAssetInfo(address, network, callback) {
        if (!this.#scheduledResolveAssetInfoActions[network.chainId.toString()]?.data?.length) {
            this.#scheduledResolveAssetInfoActions[network.chainId.toString()] = {
                promise: new Promise((resolve, reject) => {
                    setTimeout(async () => {
                        await this.#executeBatchedFetch(network).catch(reject);
                        this.#scheduledResolveAssetInfoActions[network.chainId.toString()] = undefined;
                        resolve(0);
                    }, 500);
                }),
                data: [{ address, callback }]
            };
        }
        else {
            this.#scheduledResolveAssetInfoActions[network.chainId.toString()]?.data.push({
                address,
                callback
            });
        }
        // we are returning a promise so we can await the full execution
        return this.#scheduledResolveAssetInfoActions[network.chainId.toString()]?.promise;
    }
    // TODO: Implement on the FE once the refactor is complete and
    // all controllers from the MainController are shared across Benzin, Legends, Extension, and Mobile
    // TODO: remove src/services/assetInfo/assetInfo.ts
    async resolveAssetInfoAndSendResToUi({ requestId, address, network }) {
        this.resolveAssetInfo(address, network, (_assetInfo) => {
            this.#sendUiMessage({
                type: 'ResolveAssetInfo',
                requestId,
                ok: true,
                res: _assetInfo ?? undefined
            });
        }).catch((e) => {
            this.#sendUiMessage({
                type: 'ResolveAssetInfo',
                requestId,
                ok: false,
                error: e.message
            });
        });
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            providers: this.providers
        };
    }
}
exports.ProvidersController = ProvidersController;
//# sourceMappingURL=providers.js.map