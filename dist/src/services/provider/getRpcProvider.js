"use strict";
// @ts-nocheck
Object.defineProperty(exports, "__esModule", { value: true });
exports.getViemClientForProvider = exports.getRpcProvider = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const viem_1 = require("viem");
const getRootDomain_1 = tslib_1.__importDefault(require("../../utils/getRootDomain"));
const RPC_BATCH_CONFIG = {
    'drpc.org': 3, // batch of more than 3 requests are not allowed on free tier (response 500 with internal code 31)
    '1rpc.io': 3, // batch of more than 3 requests are not allowed on free tier (response 500 with internal code 31)
    'roninchain.com': 3 // batch of more than 3 results in response 400 with "too many requests"
    // Keep tatum.io config disabled - if restricted to 1 it hits their limit of 5 requests per minute anyways
    // 'tatum.io': 1 // batch calls are available for paid plans only (response 402)
};
const viemClientByProvider = new WeakMap();
/** Some RPCs limit batching which causes immediate failures on our end, so configure the known ones */
const getBatchCountFromUrl = (rpcUrl) => {
    try {
        const rootDomain = (0, getRootDomain_1.default)(rpcUrl);
        return RPC_BATCH_CONFIG[rootDomain];
    }
    catch {
        return undefined;
    }
};
const getRpcProvider = (rpcUrls, chainId, selectedRpcUrl, options) => {
    if (!rpcUrls.length) {
        throw new Error('rpcUrls must be a non-empty array');
    }
    let rpcUrl = rpcUrls[0];
    if (selectedRpcUrl) {
        const prefUrl = rpcUrls.find((u) => u === selectedRpcUrl);
        if (prefUrl)
            rpcUrl = prefUrl;
    }
    if (!rpcUrl) {
        throw new Error('Invalid RPC URL provided');
    }
    const batchMaxCount = getBatchCountFromUrl(rpcUrl);
    const providerOptions = batchMaxCount ? { ...options, batchMaxCount } : options;
    if (chainId) {
        const staticNetwork = ethers_1.Network.from(Number(chainId));
        if (staticNetwork) {
            return new ethers_1.JsonRpcProvider(rpcUrl, staticNetwork, { staticNetwork, ...providerOptions });
        }
    }
    return new ethers_1.JsonRpcProvider(rpcUrl, undefined, providerOptions);
};
exports.getRpcProvider = getRpcProvider;
const getViemClientForProvider = (provider) => {
    const cached = viemClientByProvider.get(provider);
    if (cached)
        return cached;
    const client = (0, viem_1.createPublicClient)({
        transport: (0, viem_1.custom)({
            request: ({ method, params }) => provider.send(method, params || [])
        })
    });
    viemClientByProvider.set(provider, client);
    return client;
};
exports.getViemClientForProvider = getViemClientForProvider;
//# sourceMappingURL=getRpcProvider.js.map