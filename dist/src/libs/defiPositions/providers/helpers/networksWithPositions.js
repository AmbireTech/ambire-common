"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const getAccountNetworksWithPositions = (accountId, accountState, oldNetworksWithPositionsByAccounts, providers) => {
    const networksWithPositions = {
        ...oldNetworksWithPositionsByAccounts[accountId]
    };
    Object.keys(accountState).forEach((chainId) => {
        if (!providers[chainId])
            return;
        const isRPCDown = !providers[chainId].isWorking;
        const { positionsByProvider, error, providerErrors } = accountState[chainId];
        // RPC is down or an error occurred
        if (error || isRPCDown || providerErrors?.length)
            return;
        networksWithPositions[chainId] = positionsByProvider.reduce((networksWithPositionsByProviders, provider) => {
            if (networksWithPositionsByProviders.includes(provider.providerName))
                return networksWithPositionsByProviders;
            networksWithPositionsByProviders.push(provider.providerName);
            return networksWithPositionsByProviders;
        }, networksWithPositions[chainId] || []);
    });
    return networksWithPositions;
};
exports.default = getAccountNetworksWithPositions;
//# sourceMappingURL=networksWithPositions.js.map