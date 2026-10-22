"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearDiscoverTxnTokensCache = void 0;
exports.discoverTxnTokens = discoverTxnTokens;
const accessListCall_1 = require("../../libs/tracer/accessListCall");
const debugTraceCall_1 = require("../../libs/tracer/debugTraceCall");
const ethSimulatev1_1 = require("../../libs/tracer/ethSimulatev1");
const discoveryMethodCache = new Map();
/**
 * A helper function to use in the tests only
 */
const clearDiscoverTxnTokensCache = () => discoveryMethodCache.clear();
exports.clearDiscoverTxnTokensCache = clearDiscoverTxnTokensCache;
/**
 * Goal: discover tokens that are interacting with the account during a txn
 * To do this, we use 3 methods:
 * - debug_traceCall
 * - eth_simulateV1
 * - eth_createAccessList
 * The end product of each method is similar. However, an access list can only
 * identify NFT contract addresses, while the other methods can also identify
 * token IDs from transfer logs. Different methods are supported on different
 * chains depending on the chain configs and RPC.
 * Also, some accounts require state overrides which may not be supported
 * on the specific chain. That's why we have 3 methods and rely on 1
 * having the exact support we need. The log-capable methods are preferred so
 * non-enumerable NFT token IDs can be discovered. Access-list discovery is the
 * best-effort fallback.
 * We also have a memory cache. It's simple: record the method that succeeded
 * for chain-account. The next time discoverTxnTokens is called, it will start
 * from the successful log-capable method.
 */
async function discoverTxnTokens({ account, accountOp, accountState, baseAccount, network, isCurrent }) {
    // we cannot perform a token discovery if there's no accountState
    if (!accountState)
        return null;
    const stateOverride = (0, debugTraceCall_1.getStateOverride)(account, accountOp, accountState);
    const shouldUseAccessList = (0, accessListCall_1.getShouldUseAccessListCall)(account, accountState, !!stateOverride);
    const methodCalls = {
        eth_createAccessList: async () => {
            const addresses = await (0, accessListCall_1.createAccessListCall)(baseAccount, accountOp, network, accountState);
            return { tokens: addresses, nfts: addresses.map((address) => [address, []]) };
        },
        debug_traceCall: () => (0, debugTraceCall_1.debugTraceCall)(baseAccount, accountOp, network, accountState, stateOverride),
        eth_simulateV1: () => (0, ethSimulatev1_1.ethSimulateV1)(baseAccount, accountOp, network, accountState)
    };
    const availableMethods = [
        'debug_traceCall',
        'eth_simulateV1',
        ...(shouldUseAccessList ? ['eth_createAccessList'] : [])
    ];
    const cacheKey = `${network.chainId}-${account.addr}`;
    const cachedMethod = discoveryMethodCache.get(cacheKey);
    const orderedMethods = cachedMethod &&
        cachedMethod !== 'eth_createAccessList' &&
        availableMethods.includes(cachedMethod)
        ? [cachedMethod, ...availableMethods.filter((method) => method !== cachedMethod)]
        : availableMethods;
    let discoveredAssets = null;
    let lastError;
    for (const method of orderedMethods) {
        console.log(`Debug: using ${method} for asset discovery`);
        try {
            discoveredAssets = await methodCalls[method]();
            if (method === 'eth_createAccessList')
                discoveryMethodCache.delete(cacheKey);
            else
                discoveryMethodCache.set(cacheKey, method);
            break;
        }
        catch (error) {
            lastError = error;
            // do not emit an error here as there is a retry mechanism
            console.log(`${method} failed`, error);
        }
        // If this discovery run has been superseded, do not continue with its fallbacks.
        if (!isCurrent())
            return null;
    }
    if (!discoveredAssets)
        throw lastError;
    if (!isCurrent())
        return null;
    return discoveredAssets;
}
//# sourceMappingURL=discoverTxnTokens.js.map