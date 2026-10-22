"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VerificationController = exports.COLIBRI_CATCH_UP_RETRIES = exports.COLIBRI_CATCH_UP_RETRY_INTERVAL = void 0;
const tslib_1 = require("tslib");
const deploy_1 = require("../../consts/deploy");
const deployless_1 = require("../../libs/deployless/deployless");
const colibri_1 = require("../../libs/networks/colibri");
const portfolio_1 = require("../../libs/portfolio");
const colibri_2 = require("../../services/provider/colibri");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const SYNC_HEALTH_CHECK_RETRY_INTERVAL = 10000;
exports.COLIBRI_CATCH_UP_RETRY_INTERVAL = 3000;
exports.COLIBRI_CATCH_UP_RETRIES = 5;
// When comparing the RPC head with the Colibri head, allow a small gap before
// declaring the data non-comparable. Ethereum blocks are ~12s apart, so a
// smaller threshold is enough; faster chains need a larger one.
const ETHEREUM_COLIBRI_BLOCK_DIFF_THRESHOLD = 5;
const DEFAULT_COLIBRI_BLOCK_DIFF_THRESHOLD = 10;
const isOutOfSyncError = (error) => (error?.message || error?.toString?.() || '').toLowerCase().includes('out of sync');
class VerificationController extends eventEmitter_1.default {
    #networks;
    #fetch;
    #velcroUrl;
    #featureFlags;
    initialLoadPromise;
    statusesByChainId = {};
    #providers = {};
    #connectionUrls = {};
    // Reused Colibri-backed portfolio libs, keyed by `${chainId}:${accountId}`.
    #verificationPortfolioLibs = new Map();
    #syncPromises = {};
    constructor({ eventEmitterRegistry, networks, fetch, velcroUrl, featureFlags }) {
        super(eventEmitterRegistry);
        this.#networks = networks;
        this.#fetch = fetch;
        this.#velcroUrl = velcroUrl;
        this.#featureFlags = featureFlags;
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    async #load() {
        await this.#networks.initialLoadPromise;
        this.updateNetworks(this.#networks.allNetworks);
    }
    getReadyProvider(chainId) {
        const stringChainId = chainId.toString();
        if (this.statusesByChainId[stringChainId]?.status !== 'ready')
            return null;
        const provider = this.#providers[stringChainId]?.provider;
        if (!provider)
            return null;
        if (provider.destroyed) {
            delete this.#providers[stringChainId];
            this.#setStatus(chainId, {
                status: 'failed',
                provider: 'colibri',
                error: 'Colibri verifier provider was shut down',
                updatedAt: Date.now()
            });
            return null;
        }
        return provider;
    }
    #getVerificationPortfolioLib(account, network, provider) {
        const key = `${network.chainId}:${account.addr}`;
        const libForKey = this.#verificationPortfolioLibs.get(key);
        // Recreate the lib when the underlying Colibri provider was swapped (e.g. after a resync)
        if (!libForKey || libForKey.provider !== provider) {
            this.#verificationPortfolioLibs.set(key, new portfolio_1.Portfolio(this.#fetch, provider, 
            // Colibri verification must not use state overrides or deployless
            // contract-creation calls. The actual verifier calls are routed to
            // deployed getter contracts through GetOptions.deployless below.
            { ...network, rpcNoStateOverride: true }, this.#velcroUrl, undefined, () => this.#featureFlags?.isFeatureEnabled('tokenPrices') !== false));
        }
        return this.#verificationPortfolioLibs.get(key);
    }
    /**
     * Cryptographically verify an already-fetched RPC portfolio result against Colibri.
     *
     * This runs off the portfolio's critical path (the balances are already shown
     * by the time this is called). Because Colibri can prove state for any block up
     * to its head, we verify at the exact block the RPC used (`rpcResult.blockNumber`)
     * instead of coordinating a shared block before fetching. The head gap only
     * decides whether a fresh, comparable result is possible at all:
     * - RPC far behind Colibri -> `stale` (the shown balances are old)
     * - Colibri far behind the RPC -> `warning` (cannot verify)
     * - Colibri slightly behind the RPC -> wait briefly for Colibri to catch up,
     *   then verify or report a warning
     */
    async verifyPortfolio(params) {
        const { account, network, rpcResult, getOptions, tokenDataCache } = params;
        const rpcBlockNumber = BigInt(rpcResult.blockNumber);
        const updatedAt = Date.now();
        const provider = this.getReadyProvider(network.chainId);
        if (!provider) {
            return {
                provider: 'colibri',
                status: 'warning',
                error: 'Colibri verifier is not ready',
                updatedAt
            };
        }
        const blockDiffThreshold = network.chainId === 1n
            ? ETHEREUM_COLIBRI_BLOCK_DIFF_THRESHOLD
            : DEFAULT_COLIBRI_BLOCK_DIFF_THRESHOLD;
        let verificationBlockNumber = 0n;
        try {
            for (let retry = 0; retry <= exports.COLIBRI_CATCH_UP_RETRIES; retry += 1) {
                verificationBlockNumber = BigInt(await provider.getBlockNumber());
                if (verificationBlockNumber >= rpcResult.blockNumber)
                    break;
                const blockDiff = rpcBlockNumber - verificationBlockNumber;
                if (blockDiff > blockDiffThreshold)
                    break;
                if (retry === exports.COLIBRI_CATCH_UP_RETRIES)
                    break;
                await (0, wait_1.default)(exports.COLIBRI_CATCH_UP_RETRY_INTERVAL);
            }
        }
        catch (error) {
            this.emitError({
                level: 'silent',
                message: `Error while resolving the Colibri head block on ${network.name} (${network.chainId}).`,
                error
            });
            return {
                provider: 'colibri',
                status: 'warning',
                error: 'Colibri could not resolve its latest block',
                updatedAt
            };
        }
        const blockDiff = Math.abs(Number(rpcBlockNumber - verificationBlockNumber));
        if (rpcBlockNumber < verificationBlockNumber && blockDiff > blockDiffThreshold) {
            return { provider: 'colibri', status: 'stale', blockDiff, updatedAt };
        }
        if (verificationBlockNumber < rpcBlockNumber) {
            return {
                provider: 'colibri',
                status: 'warning',
                error: `Colibri is ${blockDiff} blocks behind the RPC latest block`,
                updatedAt
            };
        }
        const portfolioLib = this.#getVerificationPortfolioLib(account, network, provider);
        let verifiedResult;
        try {
            verifiedResult = await portfolioLib.get(account.addr, {
                ...getOptions,
                tokenDataCache: new Map(tokenDataCache),
                blockTag: Number(rpcBlockNumber),
                disableAutoDiscovery: true,
                deployless: {
                    erc20: { mode: deployless_1.DeploylessMode.Predeployed, to: deploy_1.BALANCE_GETTER },
                    erc721: { mode: deployless_1.DeploylessMode.Predeployed, to: deploy_1.NFT_GETTER }
                }
            });
        }
        catch (error) {
            this.emitError({
                level: 'silent',
                message: `Error while verifying portfolio through Colibri on ${network.name} (${network.chainId}).`,
                error
            });
            return {
                provider: 'colibri',
                status: 'warning',
                error: 'Colibri could not verify portfolio balances',
                updatedAt
            };
        }
        return this.#comparePortfolioBalances(rpcResult, verifiedResult);
    }
    #comparePortfolioBalances(rpcResult, verifiedResult) {
        const updatedAt = Date.now();
        const rpcTokenAmounts = new Map(rpcResult.tokens.map((token) => [
            token.address.toLowerCase(),
            token.latestAmount ?? token.amount
        ]));
        const verifiedTokenAmounts = new Map(verifiedResult.tokens.map((token) => [token.address.toLowerCase(), token.amount]));
        const mismatches = [];
        rpcTokenAmounts.forEach((rpcAmount, address) => {
            const verifiedAmount = verifiedTokenAmounts.get(address) ?? 0n;
            if (rpcAmount !== verifiedAmount)
                mismatches.push(address);
        });
        verifiedTokenAmounts.forEach((verifiedAmount, address) => {
            if (!rpcTokenAmounts.has(address) && verifiedAmount !== 0n)
                mismatches.push(address);
        });
        if (mismatches.length) {
            return {
                provider: 'colibri',
                status: 'warning',
                error: `${mismatches.length} balance(s) differed from the Colibri verified result`,
                updatedAt
            };
        }
        return { provider: 'colibri', status: 'success', updatedAt };
    }
    updateNetworks(networks) {
        networks.forEach((network) => {
            this.#syncNetwork(network);
        });
    }
    init({ networks }) {
        this.updateNetworks(networks);
    }
    #setStatus(chainId, status) {
        this.statusesByChainId = {
            ...this.statusesByChainId,
            [chainId.toString()]: status
        };
        this.emitUpdate();
    }
    #destroyProvider(chainId) {
        const stringChainId = chainId.toString();
        const provider = this.#providers[stringChainId]?.provider;
        this.#destroyRpcProvider(provider);
        delete this.#providers[stringChainId];
    }
    #destroyRpcProvider(provider) {
        if (!provider || provider.destroyed)
            return;
        provider.destroy();
    }
    #getVerifierConfig(network) {
        if (network.disabled)
            return null;
        if (!network.isColibriEnabled)
            return null;
        const proverUrls = (0, colibri_1.getDefaultColibriProverUrls)(network.chainId);
        if (!proverUrls.length)
            return null;
        return {
            connectionUrl: `colibri:${network.selectedRpcUrl}:${proverUrls.join(',')}`
        };
    }
    #syncNetwork(network) {
        const stringChainId = network.chainId.toString();
        const verifierConfig = this.#getVerifierConfig(network);
        if (!verifierConfig) {
            this.#destroyProvider(network.chainId);
            delete this.#syncPromises[stringChainId];
            delete this.#connectionUrls[stringChainId];
            this.#setStatus(network.chainId, { status: 'not-configured', updatedAt: Date.now() });
            return;
        }
        const { connectionUrl } = verifierConfig;
        const currentConnectionUrl = this.#connectionUrls[stringChainId];
        const currentStatus = this.statusesByChainId[stringChainId]?.status;
        if (currentConnectionUrl === connectionUrl &&
            (currentStatus === 'syncing' || currentStatus === 'ready')) {
            return;
        }
        const existingProvider = this.#providers[stringChainId];
        if (existingProvider?.connectionUrl === connectionUrl &&
            this.statusesByChainId[stringChainId]?.status === 'ready') {
            return;
        }
        const existingSync = this.#syncPromises[stringChainId];
        if (existingSync?.connectionUrl === connectionUrl)
            return;
        this.#destroyProvider(network.chainId);
        this.#connectionUrls[stringChainId] = connectionUrl;
        this.#setStatus(network.chainId, {
            status: 'syncing',
            provider: 'colibri',
            updatedAt: Date.now()
        });
        let syncPromise;
        syncPromise = (async () => {
            let provider = null;
            try {
                provider = await Promise.resolve((0, colibri_2.getColibriRpcProvider)(network));
                if (this.#syncPromises[stringChainId]?.promise !== syncPromise) {
                    this.#destroyRpcProvider(provider);
                    return;
                }
                this.#providers[stringChainId] = {
                    connectionUrl,
                    provider
                };
                while (this.#syncPromises[stringChainId]?.promise === syncPromise) {
                    try {
                        await provider.waitSynced?.();
                        await provider.send('eth_blockNumber', []);
                        if (this.#syncPromises[stringChainId]?.promise !== syncPromise) {
                            this.#destroyRpcProvider(provider);
                            return;
                        }
                        this.#setStatus(network.chainId, {
                            status: 'ready',
                            provider: 'colibri',
                            updatedAt: Date.now()
                        });
                        return;
                    }
                    catch (syncError) {
                        if (!isOutOfSyncError(syncError))
                            throw syncError;
                        this.#setStatus(network.chainId, {
                            status: 'syncing',
                            provider: 'colibri',
                            error: syncError?.message || 'Colibri verifier is out of sync',
                            updatedAt: Date.now()
                        });
                        await (0, wait_1.default)(SYNC_HEALTH_CHECK_RETRY_INTERVAL);
                    }
                }
                this.#destroyRpcProvider(provider);
            }
            catch (error) {
                this.#destroyRpcProvider(provider);
                if (this.#syncPromises[stringChainId]?.promise !== syncPromise) {
                    if (this.#providers[stringChainId]?.provider === provider) {
                        delete this.#providers[stringChainId];
                    }
                    return;
                }
                delete this.#providers[stringChainId];
                this.#setStatus(network.chainId, {
                    status: 'failed',
                    provider: 'colibri',
                    error: error?.message || 'Failed to initialize Colibri verifier',
                    updatedAt: Date.now()
                });
            }
        })();
        this.#syncPromises[stringChainId] = {
            connectionUrl,
            promise: syncPromise
        };
        syncPromise.finally(() => {
            if (this.#syncPromises[stringChainId]?.promise === syncPromise) {
                delete this.#syncPromises[stringChainId];
            }
        });
    }
}
exports.VerificationController = VerificationController;
//# sourceMappingURL=verification.js.map