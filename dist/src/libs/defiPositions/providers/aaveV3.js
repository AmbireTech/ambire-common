"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAAVEPositions = getAAVEPositions;
const tslib_1 = require("tslib");
const DeFiAAVEPosition_json_1 = tslib_1.__importDefault(require("../../../../contracts/compiled/DeFiAAVEPosition.json"));
const uuid_1 = require("../../../utils/uuid");
const deployless_1 = require("../../deployless/deployless");
const defiAddresses_1 = require("../defiAddresses");
const helpers_1 = require("../helpers");
const types_1 = require("../types");
const AAVE_NO_HEALTH_FACTOR_MAGIC_NUMBER = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
async function getAAVEPositions(userAddr, provider, network) {
    const { chainId } = network;
    if (chainId && !defiAddresses_1.AAVE_V3[chainId.toString()])
        return null;
    const { poolAddr } = defiAddresses_1.AAVE_V3[chainId.toString()];
    const deploylessDeFiPositionsGetter = (0, deployless_1.fromDescriptor)(provider, DeFiAAVEPosition_json_1.default, network.rpcNoStateOverride);
    const [[result0], [result1], [result2]] = await Promise.all([
        deploylessDeFiPositionsGetter.call('getAAVEPosition', [userAddr, poolAddr, 0, 15], {}),
        deploylessDeFiPositionsGetter.call('getAAVEPosition', [userAddr, poolAddr, 15, 30], {}),
        deploylessDeFiPositionsGetter.call('getAAVEPosition', [userAddr, poolAddr, 30, 45], {})
    ]);
    const accountDataRes = result0[1];
    const userAssets = [...result0[0], ...result1[0], ...result2[0]]
        .map((asset) => ({
        address: asset[0],
        symbol: asset[1],
        name: asset[2],
        balance: asset[3],
        decimals: asset[4],
        price: asset[5],
        borrowAssetBalance: asset[6],
        stableBorrowAssetBalance: asset[7],
        currentLiquidityRate: asset[8],
        currentVariableBorrowRate: asset[9],
        currentStableBorrowRate: asset[10],
        aaveAddress: asset[11],
        aaveSymbol: asset[12],
        aaveName: asset[13],
        aaveDecimals: asset[14],
        aaveSDebtAddr: asset[15],
        aaveSDebtSymbol: asset[16],
        aaveSDebtName: asset[17],
        aaveSDebtDecimals: asset[18],
        aaveVDebtAddr: asset[19],
        aaveVDebtSymbol: asset[20],
        aaveVDebtName: asset[21],
        aaveVDebtDecimals: asset[22]
    }))
        .filter((t) => t.balance > 0 || t.borrowAssetBalance > 0 || t.stableBorrowAssetBalance > 0);
    const accountData = {
        totalCollateralBase: accountDataRes[0],
        totalDebtBase: accountDataRes[1],
        availableBorrowsBase: accountDataRes[2],
        currentLiquidationThreshold: accountDataRes[3],
        ltv: accountDataRes[4],
        healthFactor: accountDataRes[5]
    };
    if (accountData.healthFactor === AAVE_NO_HEALTH_FACTOR_MAGIC_NUMBER) {
        accountData.healthFactor = null;
    }
    const position = {
        id: (0, uuid_1.generateUuid)(),
        additionalData: {
            healthRate: accountData.healthFactor ? Number(accountData.healthFactor) / 1e18 : null,
            positionInUSD: 0,
            deptInUSD: 0,
            collateralInUSD: 0,
            availableBorrowInUSD: Number(accountData.availableBorrowsBase) / 1e8
        },
        assets: []
    };
    position.assets = userAssets
        .map((asset) => {
        const balance = Number(asset.balance) / 10 ** Number(asset.decimals);
        const price = Number(asset.price) / 1e8;
        const borrow = (Number(asset.borrowAssetBalance) / 10 ** Number(asset.decimals)) * -1;
        const stableBorrow = (Number(asset.stableBorrowAssetBalance) / 10 ** Number(asset.decimals)) * -1;
        position.additionalData.positionInUSD += (balance + borrow + stableBorrow) * price;
        position.additionalData.deptInUSD += borrow * price;
        position.additionalData.deptInUSD += stableBorrow * price;
        position.additionalData.collateralInUSD += balance * price;
        const assetsResult = [];
        const priceIn = [{ baseCurrency: 'usd', price }];
        if (asset.balance > 0) {
            assetsResult.push({
                address: asset.address,
                symbol: asset.symbol,
                name: asset.name,
                decimals: Number(asset.decimals),
                amount: asset.balance,
                priceIn,
                value: (0, helpers_1.getAssetValue)(asset.balance, Number(asset.decimals), priceIn),
                type: types_1.AssetType.Collateral,
                additionalData: {
                    APY: Number(asset.currentLiquidityRate) / 10 ** 25
                },
                protocolAsset: {
                    address: asset.aaveAddress,
                    symbol: asset.aaveSymbol,
                    name: asset.aaveName,
                    decimals: asset.aaveDecimals
                }
            });
        }
        if (asset.stableBorrowAssetBalanc > 0) {
            assetsResult.push({
                address: asset.address,
                symbol: asset.symbol,
                name: asset.name,
                decimals: Number(asset.decimals),
                amount: asset.stableBorrowAssetBalanc,
                priceIn,
                value: (0, helpers_1.getAssetValue)(asset.stableBorrowAssetBalanc, Number(asset.decimals), priceIn),
                type: types_1.AssetType.Borrow,
                additionalData: {
                    APY: Number(asset.currentStableBorrowRate) / 10 ** 25
                },
                protocolAsset: {
                    address: asset.aaveSDebtAddr,
                    symbol: asset.aaveSDebtSymbol,
                    name: asset.aaveSDebtName,
                    decimals: asset.aaveSDebtDecimals
                }
            });
        }
        if (asset.borrowAssetBalance > 0) {
            assetsResult.push({
                address: asset.address,
                symbol: asset.symbol,
                name: asset.name,
                decimals: Number(asset.decimals),
                amount: asset.borrowAssetBalance,
                priceIn,
                value: (0, helpers_1.getAssetValue)(asset.borrowAssetBalance, Number(asset.decimals), priceIn),
                type: types_1.AssetType.Borrow,
                additionalData: {
                    APY: Number(asset.currentVariableBorrowRate) / 10 ** 25
                },
                protocolAsset: {
                    address: asset.aaveVDebtAddr,
                    symbol: asset.aaveVDebtSymbol,
                    name: asset.name,
                    decimals: asset.aaveVDebtDecimals
                }
            });
        }
        return assetsResult;
    })
        .flat();
    if (position.additionalData.positionInUSD === 0 || !position.assets.length)
        return null;
    return {
        providerName: 'AAVE v3',
        chainId,
        type: 'lending',
        positions: [position],
        positionInUSD: position.additionalData.positionInUSD
    };
}
//# sourceMappingURL=aaveV3.js.map