"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRpcProvider = void 0;
const ethers_1 = require("ethers");
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
    if (chainId) {
        const staticNetwork = ethers_1.Network.from(Number(chainId));
        if (staticNetwork) {
            return new ethers_1.JsonRpcProvider(rpcUrl, staticNetwork, { staticNetwork, ...options });
        }
    }
    return new ethers_1.JsonRpcProvider(rpcUrl);
};
exports.getRpcProvider = getRpcProvider;
//# sourceMappingURL=getRpcProvider.js.map