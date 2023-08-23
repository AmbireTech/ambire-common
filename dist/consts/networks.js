"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.networks = void 0;
const networks = [
    {
        id: 'ethereum',
        name: 'Ethereum',
        nativeAssetSymbol: 'ETH',
        rpcUrl: 'https://rpc.ankr.com/eth',
        rpcNoStateOverride: false,
        chainId: 1n
    },
    {
        id: 'polygon',
        name: 'Polygon',
        nativeAssetSymbol: 'MATIC',
        rpcUrl: 'https://rpc.ankr.com/polygon',
        rpcNoStateOverride: false,
        chainId: 137n
    },
    {
        id: 'optimism',
        name: 'Optimism',
        nativeAssetSymbol: 'ETH',
        rpcUrl: 'https://rpc.ankr.com/optimism',
        rpcNoStateOverride: false,
        chainId: 10n
    },
    {
        id: 'hardhat',
        name: 'hardhat',
        nativeAssetSymbol: 'ETH',
        rpcUrl: '',
        rpcNoStateOverride: true,
        chainId: 31337n
    }
];
exports.networks = networks;
//# sourceMappingURL=networks.js.map