"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PINNED_TOKENS = void 0;
// Rules:
// 1. Pinned gas tank tokens with the same address are shared between networks. This means
// that if ETH is pinned on Ethereum and onGasTank is true, the same token shouldn't be
// onGasTank on Optimism.
// 2. Addresses must be checksummed.
exports.PINNED_TOKENS = [
    // $ETH
    {
        networkId: 'ethereum',
        address: '0x0000000000000000000000000000000000000000',
        onGasTank: true
    },
    {
        networkId: 'optimism',
        address: '0x0000000000000000000000000000000000000000',
        onGasTank: false
    },
    // $WALLET
    {
        networkId: 'ethereum',
        address: '0x88800092fF476844f74dC2FC427974BBee2794Ae',
        onGasTank: false
    },
    // $USDC
    {
        networkId: 'ethereum',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        onGasTank: true
    },
    {
        networkId: 'optimism',
        address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        onGasTank: true
    }
];
//# sourceMappingURL=pinnedTokens.js.map