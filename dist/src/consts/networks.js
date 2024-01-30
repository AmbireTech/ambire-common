"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nativeTokens = exports.networks = void 0;
const deploy_1 = require("./deploy");
const networks = [
    {
        id: 'ethereum',
        name: 'Ethereum',
        nativeAssetSymbol: 'ETH',
        rpcUrl: 'https://rpc.ankr.com/eth',
        rpcNoStateOverride: false,
        chainId: 1n,
        erc4337: null
    },
    {
        id: 'polygon',
        name: 'Polygon',
        nativeAssetSymbol: 'MATIC',
        rpcUrl: 'https://rpc.ankr.com/polygon',
        rpcNoStateOverride: false,
        chainId: 137n,
        erc4337: {
            enabled: true,
            entryPointAddr: deploy_1.ERC_4337_ENTRYPOINT
        }
    },
    {
        id: 'optimism',
        name: 'Optimism',
        nativeAssetSymbol: 'ETH',
        rpcUrl: 'https://rpc.ankr.com/optimism',
        rpcNoStateOverride: false,
        chainId: 10n,
        erc4337: {
            enabled: true,
            entryPointAddr: deploy_1.ERC_4337_ENTRYPOINT
        }
    }
    // This breaks the background service of the extension
    // {
    //   id: 'hardhat',
    //   name: 'hardhat',
    //   nativeAssetSymbol: 'ETH',
    //   rpcUrl: '',
    //   rpcNoStateOverride: true,
    //   chainId: 31337n
    // }
];
exports.networks = networks;
const nativeTokens = {
    ethereum: ['ETH', 18],
    polygon: ['MATIC', 18],
    fanthom: ['FTM', 18]
};
exports.nativeTokens = nativeTokens;
//# sourceMappingURL=networks.js.map