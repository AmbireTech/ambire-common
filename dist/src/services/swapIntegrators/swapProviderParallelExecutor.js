"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapProviderParallelExecutor = void 0;
const tslib_1 = require("tslib");
const SwapAndBridgeProviderApiError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeProviderApiError"));
const wait_1 = tslib_1.__importStar(require("../../utils/wait"));
const GET_SUPPORTED_CHAINS_TIMEOUT = 10000;
const GET_TO_TOKEN_LIST_TIMEOUT = 30000;
class SwapProviderParallelExecutor {
    id = 'parallel';
    name = 'Parallel';
    isHealthy = null;
    #providers;
    #getFallbackSupportedChains;
    #getDisabledProviders;
    // Added for compatibility with the type
    supportedChains = [];
    constructor(providers, getFallbackSupportedChains, getDisabledProviders = () => []) {
        this.#providers = providers;
        this.#getFallbackSupportedChains = getFallbackSupportedChains;
        this.#getDisabledProviders = getDisabledProviders;
    }
    /** Returns serializable metadata without exposing the private provider instances. */
    getProvidersInfo() {
        return this.#providers.map(({ id, name }) => ({ id, name }));
    }
    #getEnabledProviders() {
        const disabledProviders = this.#getDisabledProviders();
        return this.#providers.filter(({ id }) => !disabledProviders.includes(id));
    }
    /**
     * In the dual setup, we're not using the health feature as
     * we're hoping that at least one provider is going to work at all times
     */
    updateHealth() {
        this.isHealthy = null;
    }
    resetHealth() {
        this.isHealthy = null;
    }
    async #fetchFromAll(fetchMethod, reqMeta) {
        const { chainIds = [] } = reqMeta || {};
        const uniqueChainIds = [...new Set(chainIds)];
        const MIN_WAIT = 3000; // 3s
        const MAX_WAIT_AFTER_FIRST_COMPLETED = 2000; // 2s
        const MAX_ABSOLUTE_WAIT_FOR_ALL_TO_COMPLETE = 15000; // 15s
        const results = [];
        const startTime = Date.now();
        const supportedProviders = this.#getEnabledProviders().filter((provider) => {
            // If the request is not chainId specific, use all providers
            if (!uniqueChainIds.length)
                return true;
            if (reqMeta?.chainIds?.length === 2 && provider.areChainsSupported) {
                return provider.areChainsSupported({
                    fromChainId: reqMeta.chainIds[0],
                    toChainId: reqMeta.chainIds[1]
                });
            }
            // If supportedChains is not set yet, we just try to use the provider
            if (provider.supportedChains === null)
                return true;
            const supportedChainIds = provider.supportedChains.map(({ chainId }) => chainId);
            const res = uniqueChainIds.every((chainId) => supportedChainIds?.includes(chainId));
            return res;
        });
        if (!supportedProviders.length) {
            throw new SwapAndBridgeProviderApiError_1.default(`The requested network(s) are not supported by any available service provider. Chain IDs: ${uniqueChainIds.join(', ')}`);
        }
        const tasks = supportedProviders.map((provider) => fetchMethod(provider)
            .then((result) => ({ provider, result }))
            .catch((err) => ({ provider, result: err }))
            .then((result) => {
            results.push(result);
            return result;
        }));
        const waitPromise = (0, wait_1.waitWithAbort)(MAX_ABSOLUTE_WAIT_FOR_ALL_TO_COMPLETE);
        const absoluteTimeout = waitPromise.promise.then(() => {
            throw new Error('Our service providers are temporarily unavailable or your internet connection is too slow.');
        });
        await Promise.race([Promise.race(tasks), absoluteTimeout]);
        if (waitPromise.abort)
            waitPromise.abort();
        // Figure out how long we've already waited
        const elapsed = Date.now() - startTime;
        // If first was too quick, extend wait time so total ≥ MIN_WAIT
        const remainingMinWait = Math.max(0, MIN_WAIT - elapsed);
        await Promise.race([
            Promise.allSettled(tasks),
            (0, wait_1.default)(MAX_WAIT_AFTER_FIRST_COMPLETED + remainingMinWait)
        ]);
        const valid = results.map((r) => r.result).filter((r) => !(r instanceof Error));
        if (valid.length > 0)
            return valid.flat();
        const errors = results.map((r) => r.result).filter((r) => r instanceof Error);
        if (!errors.length) {
            throw new SwapAndBridgeProviderApiError_1.default('Our service providers are currently unavailable. Please try again later.');
        }
        // Use the first error (LiFi) as base message, since the bet is that's the the most accurate
        const baseMessage = errors[0].message || 'Unknown error';
        // Extract technical details from all errors (that's the content between < and >)
        const technicalDetails = errors
            .map((error) => {
            const message = error.message || '';
            const match = message.match(/<([^>]+)>/);
            return match ? match[1] : null;
        })
            .filter(Boolean);
        // Modify the base message to indicate multiple providers
        const providerNames = supportedProviders.map((p) => p.name).join(' and ');
        let combinedMessage = baseMessage
            .replace(/\bLiFi\b/g, providerNames)
            .replace(/\bis temporarily unavailable\b/g, 'are temporarily unavailable');
        // make it plural only if there are multiple
        if (providerNames.length > 1) {
            combinedMessage = combinedMessage.replace(/\bservice provider\b/g, 'service providers');
        }
        // Replace the technical details with combined ones
        if (technicalDetails.length > 0) {
            const combinedDetails = technicalDetails.join('> and <');
            combinedMessage = combinedMessage.replace(/<[^>]+>/, `<${combinedDetails}>`);
        }
        throw new SwapAndBridgeProviderApiError_1.default(combinedMessage);
    }
    async #routeTo(providerId, method, ...args) {
        const provider = this.#providers.find((p) => p.id === providerId);
        if (!provider)
            throw new Error('Swap provider misconfiguration');
        return provider[method](...args);
    }
    async #getSupportedChainsWithTimeout(provider) {
        const waitPromise = (0, wait_1.waitWithAbort)(GET_SUPPORTED_CHAINS_TIMEOUT);
        try {
            return await Promise.race([
                provider.getSupportedChains().catch((e) => e),
                waitPromise.promise.then(() => new Error('Get supported chains timeout'))
            ]);
        }
        finally {
            if (waitPromise.abort)
                waitPromise.abort();
        }
    }
    async getSupportedChains() {
        const enabledProviders = this.#getEnabledProviders();
        if (!enabledProviders.length)
            return [];
        const promises = enabledProviders.map((provider) => this.#getSupportedChainsWithTimeout(provider));
        const fetchResults = await Promise.all(promises);
        const chainIds = fetchResults
            .filter((r) => !(r instanceof Error))
            .flat();
        // filter duplicates
        const uniqueChainIds = [
            ...new Map(chainIds.map((item) => [item.chainId, item])).values()
        ];
        // A broad fallback would reintroduce chains that may only work with a disabled provider.
        const areAllProvidersEnabled = enabledProviders.length === this.#providers.length;
        if (uniqueChainIds.length < 10 && this.#getFallbackSupportedChains && areAllProvidersEnabled) {
            return this.#getFallbackSupportedChains();
        }
        return uniqueChainIds;
    }
    async getToTokenList({ fromChainId, toChainId, onUpdate }) {
        const supportedProviders = this.#getEnabledProviders().filter((provider) => {
            if (provider.areChainsSupported) {
                return provider.areChainsSupported({ fromChainId, toChainId });
            }
            if (provider.supportedChains === null)
                return true;
            const supportedChainIds = provider.supportedChains.map(({ chainId }) => chainId);
            return supportedChainIds.includes(fromChainId) && supportedChainIds.includes(toChainId);
        });
        if (!supportedProviders.length) {
            throw new SwapAndBridgeProviderApiError_1.default(`The requested network(s) are not supported by any available service provider. Chain IDs: ${[
                ...new Set([fromChainId, toChainId])
            ].join(', ')}`);
        }
        // Kept per provider to merge in registration order, not answer order
        const tokenListsByProvider = new Map();
        const loadingProviders = new Set(supportedProviders);
        let toTokenList = [];
        const requests = supportedProviders.map(async (provider) => {
            const waitPromise = (0, wait_1.waitWithAbort)(GET_TO_TOKEN_LIST_TIMEOUT);
            try {
                const result = await Promise.race([
                    provider
                        .getToTokenList({ fromChainId, toChainId })
                        .catch((error) => error instanceof Error ? error : new Error('Get to token list failed')),
                    waitPromise.promise.then(() => new Error('Get to token list timeout'))
                ]);
                loadingProviders.delete(provider);
                if (!(result instanceof Error))
                    tokenListsByProvider.set(provider, result);
                // Nothing to report until a provider returns tokens
                if (tokenListsByProvider.size) {
                    toTokenList = this.#mergeTokenLists(supportedProviders.map((p) => tokenListsByProvider.get(p) || []));
                    onUpdate?.(toTokenList, [...loadingProviders].map(({ name }) => name));
                }
                return result;
            }
            finally {
                if (waitPromise.abort)
                    waitPromise.abort();
            }
        });
        const results = await Promise.all(requests);
        if (!results.some((result) => !(result instanceof Error))) {
            throw new SwapAndBridgeProviderApiError_1.default('Our service providers are currently unavailable. Please try again later.');
        }
        return toTokenList;
    }
    /** A duplicate token keeps the position and data of the first provider. */
    #mergeTokenLists(tokenLists) {
        const tokensById = new Map();
        tokenLists.forEach((tokens) => {
            tokens.forEach((token) => {
                const tokenId = `${token.chainId}-${token.address}`;
                if (!tokensById.has(tokenId))
                    tokensById.set(tokenId, token);
            });
        });
        return [...tokensById.values()];
    }
    async getToken({ address, chainId }) {
        const toTokens = await this.#fetchFromAll((provider) => provider.getToken({ address, chainId }).catch((e) => e), { chainIds: [chainId] });
        return toTokens.find((t) => t) || null;
    }
    async startRoute(route) {
        return this.#routeTo(route.providerId, 'startRoute', route);
    }
    async quote({ fromAsset, fromChainId, fromTokenAddress, toAsset, toChainId, toTokenAddress, fromAmount, userAddress, sort, accountNativeBalance, nativeSymbol, isWrapOrUnwrap, feePercent }) {
        const quotes = await this.#fetchFromAll((provider) => provider
            .quote({
            fromAsset,
            fromChainId,
            fromTokenAddress,
            toAsset,
            toChainId,
            toTokenAddress,
            fromAmount,
            userAddress,
            sort,
            accountNativeBalance,
            nativeSymbol,
            isWrapOrUnwrap,
            feePercent
        })
            .catch((e) => e), { chainIds: [fromChainId, toChainId] });
        const firstQuote = quotes[0];
        return {
            ...firstQuote,
            routes: quotes.map((q) => q.routes.flat()).flat()
        };
    }
    getRouteStatus({ txHash, fromChainId, toChainId, bridge, providerId, requestId, routeId, rawRoute }) {
        return this.#routeTo(providerId, 'getRouteStatus', {
            txHash,
            fromChainId,
            toChainId,
            bridge,
            requestId,
            routeId,
            rawRoute
        });
    }
}
exports.SwapProviderParallelExecutor = SwapProviderParallelExecutor;
//# sourceMappingURL=swapProviderParallelExecutor.js.map