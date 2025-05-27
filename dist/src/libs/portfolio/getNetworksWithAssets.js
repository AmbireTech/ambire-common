"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const getAccountNetworksWithAssets = (accountId, accountState, storageStateByAccount, providers) => {
    const networksWithAssets = { ...storageStateByAccount[accountId] };
    Object.keys(accountState).forEach((chainId) => {
        if (!providers[chainId])
            return;
        const isRPCDown = !providers[chainId].isWorking;
        const result = accountState[chainId]?.result;
        // RPC is down or an error occurred
        if (!result || isRPCDown)
            return;
        // RPC is up and we have a result
        const nonZeroTokens = result.tokens.filter(({ amount }) => Number(amount) !== 0);
        const hasCollectibles = result.collections && result.collections.length > 0;
        // The account has assets on this network
        networksWithAssets[chainId] = !!nonZeroTokens.length || !!hasCollectibles;
    });
    return networksWithAssets;
};
exports.default = getAccountNetworksWithAssets;
//# sourceMappingURL=getNetworksWithAssets.js.map