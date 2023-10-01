"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
<<<<<<< HEAD
exports.networks = void 0;
=======
exports.nativeTokens = exports.networks = void 0;
const deploy_1 = require("./deploy");
>>>>>>> v2
const networks = [
    {
        id: 'ethereum',
        name: 'Ethereum',
        nativeAssetSymbol: 'ETH',
        rpcUrl: 'https://rpc.ankr.com/eth',
        rpcNoStateOverride: false,
<<<<<<< HEAD
        chainId: 1n
=======
        chainId: 1n,
        erc4337: null
>>>>>>> v2
    },
    {
        id: 'polygon',
        name: 'Polygon',
        nativeAssetSymbol: 'MATIC',
        rpcUrl: 'https://rpc.ankr.com/polygon',
        rpcNoStateOverride: false,
<<<<<<< HEAD
        chainId: 137n
=======
        chainId: 137n,
        erc4337: {
            enabled: true,
            entryPointAddr: deploy_1.ERC_4337_ENTRYPOINT,
            entryPointMarker: deploy_1.ENTRY_POINT_MARKER
        }
>>>>>>> v2
    },
    {
        id: 'optimism',
        name: 'Optimism',
        nativeAssetSymbol: 'ETH',
        rpcUrl: 'https://rpc.ankr.com/optimism',
        rpcNoStateOverride: false,
<<<<<<< HEAD
        chainId: 10n
    }
];
exports.networks = networks;
=======
        chainId: 10n,
        erc4337: {
            enabled: true,
            entryPointAddr: deploy_1.ERC_4337_ENTRYPOINT,
            entryPointMarker: deploy_1.ENTRY_POINT_MARKER
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
>>>>>>> v2
//# sourceMappingURL=networks.js.map