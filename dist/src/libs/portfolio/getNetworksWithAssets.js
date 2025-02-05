"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const getAccountNetworksWithAssets = (accountId, accountState, storageStateByAccount, providers) => {
    const networksWithAssets = { ...storageStateByAccount[accountId] };
    Object.keys(accountState).forEach((networkId) => {
        if (!providers[networkId])
            return;
        const isRPCDown = !providers[networkId].isWorking;
        const result = accountState[networkId]?.result;
        // RPC is down or an error occurred
        if (!result || isRPCDown)
            return;
        // RPC is up and we have a result
        const nonZeroTokens = result.tokens.filter(({ amount }) => Number(amount) !== 0);
        const hasCollectibles = result.collections && result.collections.length > 0;
        // The account has assets on this network
        networksWithAssets[networkId] = !!nonZeroTokens.length || !!hasCollectibles;
    });
    return networksWithAssets;
};
exports.default = getAccountNetworksWithAssets;
//# sourceMappingURL=getNetworksWithAssets.js.map