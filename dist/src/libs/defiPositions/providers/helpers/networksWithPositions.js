"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const getAccountNetworksWithPositions = (accountId, accountState, oldNetworksWithPositionsByAccounts, providers) => {
    const networksWithPositions = {
        ...oldNetworksWithPositionsByAccounts[accountId]
    };
    Object.keys(accountState).forEach((networkId) => {
        if (!providers[networkId])
            return;
        const isRPCDown = !providers[networkId].isWorking;
        const { positionsByProvider, error, providerErrors } = accountState[networkId];
        // RPC is down or an error occurred
        if (error || isRPCDown || providerErrors?.length)
            return;
        networksWithPositions[networkId] = positionsByProvider.reduce((networksWithPositionsByProviders, provider) => {
            if (networksWithPositionsByProviders.includes(provider.providerName))
                return networksWithPositionsByProviders;
            networksWithPositionsByProviders.push(provider.providerName);
            return networksWithPositionsByProviders;
        }, networksWithPositions[networkId] || []);
    });
    return networksWithPositions;
};
exports.default = getAccountNetworksWithPositions;
//# sourceMappingURL=networksWithPositions.js.map