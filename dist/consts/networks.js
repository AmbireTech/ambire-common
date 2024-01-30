"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.networks = void 0;
const deploy_1 = require("./deploy");
const networks = [
    {
        id: 'ethereum',
        name: 'Ethereum',
        nativeAssetSymbol: 'ETH',
        rpcUrl: 'https://rpc.ankr.com/eth/5c7b8f0ac82c95161753873289e1a4f39aa69019b905b8032d76909962719be9',
        rpcNoStateOverride: false,
        chainId: 1n,
        explorerUrl: 'https://etherscan.io',
        erc4337: null,
        unstoppableDomainsChain: 'ERC20'
    },
    {
        id: 'polygon',
        name: 'Polygon',
        nativeAssetSymbol: 'MATIC',
        rpcUrl: 'https://rpc.ankr.com/polygon/5c7b8f0ac82c95161753873289e1a4f39aa69019b905b8032d76909962719be9',
        rpcNoStateOverride: false,
        chainId: 137n,
        explorerUrl: 'https://polygonscan.com',
        erc4337: {
            // TODO: temp disabled (only while testing)
            enabled: false,
            entryPointAddr: deploy_1.ERC_4337_ENTRYPOINT,
            hasPaymaster: true
        },
        unstoppableDomainsChain: 'MATIC'
    },
    {
        id: 'optimism',
        name: 'Optimism',
        nativeAssetSymbol: 'ETH',
        rpcUrl: 'https://rpc.ankr.com/optimism/5c7b8f0ac82c95161753873289e1a4f39aa69019b905b8032d76909962719be9',
        rpcNoStateOverride: false,
        chainId: 10n,
        explorerUrl: 'https://optimistic.etherscan.io',
        erc4337: {
            enabled: false,
            entryPointAddr: deploy_1.ERC_4337_ENTRYPOINT,
            hasPaymaster: false
        },
        unstoppableDomainsChain: 'ERC20'
    },
    {
        id: 'avalanche',
        name: 'Avalanche',
        nativeAssetSymbol: 'AVAX',
        rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
        rpcNoStateOverride: false,
        chainId: 43114n,
        explorerUrl: 'https://snowtrace.io',
        erc4337: {
            enabled: true,
            entryPointAddr: deploy_1.ERC_4337_ENTRYPOINT,
            hasPaymaster: true
        },
        unstoppableDomainsChain: 'ERC20'
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
//# sourceMappingURL=networks.js.map