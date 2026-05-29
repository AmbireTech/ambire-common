"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapProviderParallelExecutor = void 0;
const tslib_1 = require("tslib");
const SwapAndBridgeProviderApiError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeProviderApiError"));
const wait_1 = tslib_1.__importStar(require("../../utils/wait"));
class SwapProviderParallelExecutor {
    id = 'parallel';
    name = 'Parallel';
    isHealthy = null;
    #providers;
    // Added for compatibility with the type
    supportedChains = [];
    constructor(providers) {
        this.#providers = providers;
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
        const supportedProviders = this.#providers.filter((provider) => {
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
            .catch((err) => ({ provider, result: err })));
        const waitPromise = (0, wait_1.waitWithAbort)(MAX_ABSOLUTE_WAIT_FOR_ALL_TO_COMPLETE);
        const absoluteTimeout = waitPromise.promise.then(() => {
            throw new Error('Our service providers are temporarily unavailable or your internet connection is too slow.');
        });
        const firstResult = await Promise.race([Promise.any(tasks), absoluteTimeout]);
        if (waitPromise.abort)
            waitPromise.abort();
        if ('provider' in firstResult && 'result' in firstResult) {
            results.push(firstResult);
        }
        const remainingTasks = supportedProviders
            // Make sure the provider was not filtered out
            .filter((p) => !results.some((r) => r.provider === p))
            .map((provider) => {
            const originalIdx = supportedProviders.indexOf(provider);
            if (!tasks[originalIdx])
                return null;
            return tasks[originalIdx]
                .then((res) => res)
                .catch((err) => ({ provider, result: err }));
        });
        // Figure out how long we've already waited
        const elapsed = Date.now() - startTime;
        // If first was too quick, extend wait time so total ≥ MIN_WAIT
        const remainingMinWait = Math.max(0, MIN_WAIT - elapsed);
        const secondResult = (await Promise.race([
            // Promise.any can't be called with an empty array
            remainingTasks.length ? Promise.any(remainingTasks) : Promise.resolve(),
            (0, wait_1.default)(MAX_WAIT_AFTER_FIRST_COMPLETED + remainingMinWait)
        ]));
        if (secondResult) {
            if ('provider' in secondResult && 'result' in secondResult) {
                results.push(secondResult);
            }
        }
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
    async getSupportedChains() {
        const chainIds = await this.#fetchFromAll((provider) => provider.getSupportedChains().catch((e) => e));
        // filter duplicates
        return [
            ...new Map(chainIds.map((item) => [item.chainId, item])).values()
        ];
    }
    async getToTokenList({ fromChainId, toChainId }) {
        const toTokenList = await this.#fetchFromAll((provider) => provider.getToTokenList({ fromChainId, toChainId }).catch((e) => e), { chainIds: [fromChainId, toChainId] });
        // filter duplicates
        return [
            ...new Map(toTokenList.map((item) => [`${item.chainId}-${item.address}`, item])).values()
        ];
    }
    async getToken({ address, chainId }) {
        const toTokens = await this.#fetchFromAll((provider) => provider.getToken({ address, chainId }).catch((e) => e), { chainIds: [chainId] });
        return toTokens.find((t) => t) || null;
    }
    async startRoute(route) {
        return this.#routeTo(route.providerId, 'startRoute', route);
    }
    async quote({ fromAsset, fromChainId, fromTokenAddress, toAsset, toChainId, toTokenAddress, fromAmount, userAddress, sort, accountNativeBalance, nativeSymbol, isWrapOrUnwrap }) {
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
            isWrapOrUnwrap
        })
            .catch((e) => e), { chainIds: [fromChainId, toChainId] });
        const firstQuote = quotes[0];
        return {
            ...firstQuote,
            routes: quotes.map((q) => q.routes.flat()).flat()
        };
    }
    getRouteStatus({ txHash, fromChainId, toChainId, bridge, providerId, requestId, routeId }) {
        return this.#routeTo(providerId, 'getRouteStatus', {
            txHash,
            fromChainId,
            toChainId,
            bridge,
            requestId,
            routeId
        });
    }
}
exports.SwapProviderParallelExecutor = SwapProviderParallelExecutor;
//# sourceMappingURL=swapProviderParallelExecutor.js.map