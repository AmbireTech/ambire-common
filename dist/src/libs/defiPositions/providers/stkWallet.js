"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStakedWalletPositions = getStakedWalletPositions;
const helpers_1 = require("../helpers");
const types_1 = require("../types");
function getStakedWalletPositions(stkWallet) {
    if (!stkWallet || !stkWallet.amount)
        return null;
    const positionInUSD = (0, helpers_1.getAssetValue)(BigInt(stkWallet.amount), Number(stkWallet.decimals), stkWallet.priceIn);
    const positions = [
        {
            id: 'stk-wallet',
            additionalData: {
                name: 'Staked',
                positionInUSD
            },
            assets: [
                {
                    address: '0x88800092fF476844f74dC2FC427974BBee2794Ae', // WALLET token addr
                    symbol: 'WALLET',
                    name: 'Ambire Wallet',
                    iconUrl: '',
                    decimals: 18,
                    amount: stkWallet.amount,
                    priceIn: stkWallet.priceIn[0],
                    value: positionInUSD,
                    type: types_1.AssetType.Collateral,
                    additionalData: {},
                    protocolAsset: {
                        address: stkWallet.address,
                        symbol: stkWallet.symbol,
                        name: stkWallet.name,
                        decimals: stkWallet.decimals
                    }
                }
            ]
        }
    ];
    return {
        providerName: 'Ambire',
        chainId: 1n,
        source: 'custom',
        iconUrl: '',
        siteUrl: 'https://rewards.ambire.com',
        type: 'common',
        positionInUSD,
        positions
    };
}
//# sourceMappingURL=stkWallet.js.map