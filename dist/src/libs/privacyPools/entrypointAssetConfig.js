"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readEntrypointAssetConfig = void 0;
const ethers_1 = require("ethers");
const ENTRYPOINT_INTERFACE = new ethers_1.Interface([
    'function assetConfig(address asset) view returns (address pool, uint256 minimumDepositAmount, uint256 vettingFeeBPS, uint256 maxRelayFeeBPS)'
]);
/**
 * Reads an asset's entrypoint configuration. The SDK's `getPoolForAsset` reads it too but does not
 * expose it, and the wallet needs the pool before starting a withdrawal.
 */
const readEntrypointAssetConfig = async ({ provider, entrypointAddress, assetAddress }) => {
    const data = await provider.call({
        to: entrypointAddress,
        data: ENTRYPOINT_INTERFACE.encodeFunctionData('assetConfig', [assetAddress])
    });
    const decoded = ENTRYPOINT_INTERFACE.decodeFunctionResult('assetConfig', data);
    return {
        poolAddress: decoded.pool,
        minimumDepositAmount: BigInt(decoded.minimumDepositAmount)
    };
};
exports.readEntrypointAssetConfig = readEntrypointAssetConfig;
//# sourceMappingURL=entrypointAssetConfig.js.map