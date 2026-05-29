"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAAVEPositions = getAAVEPositions;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
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
    const poolContract = new ethers_1.Contract(poolAddr, ['function getReservesCount() view returns (uint256)'], provider);
    const deploylessDeFiPositionsGetter = (0, deployless_1.fromDescriptor)(provider, DeFiAAVEPosition_json_1.default, network.rpcNoStateOverride // Why?
    );
    const reservesLength = await poolContract.getFunction('getReservesCount').staticCall();
    const PAGE_SIZE = 15;
    const numberOfPages = Math.ceil(Number(reservesLength) / PAGE_SIZE);
    const promises = [];
    for (let i = 0; i < numberOfPages; i++) {
        promises.push(deploylessDeFiPositionsGetter.call('getAAVEPosition', [userAddr, poolAddr, i * 15, (i + 1) * 15], {}));
    }
    const results = await Promise.all(promises);
    const accountData = results[0].accountData;
    const userAssets = results
        .map((r) => r.userBalance)
        .flat()
        .map(({ addr, ...rest }) => ({
        address: addr,
        aaveAddress: rest.aaveAddr,
        ...rest
    }))
        .filter((t) => t.symbol !== 'error' &&
        t.name !== 'error' &&
        (t.balance > 0 || t.borrowAssetBalance > 0 || t.stableBorrowAssetBalance > 0));
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
            availableBorrowInUSD: Number(accountData.availableBorrowsBase) / 1e8,
            name: 'Lending'
        },
        assets: []
    };
    position.assets = userAssets
        .map((asset) => {
        const balance = Number(asset.balance) / 10 ** Number(asset.decimals);
        const price = Number(asset.price) / 1e8;
        const borrow = (Number(asset.borrowAssetBalance) / 10 ** Number(asset.decimals)) * -1;
        const stableBorrow = (Number(asset.stableBorrowAssetBalance) / 10 ** Number(asset.decimals)) * -1;
        position.additionalData.positionInUSD =
            (position.additionalData.positionInUSD || 0) + (balance + borrow + stableBorrow) * price;
        position.additionalData.debtInUSD =
            (position.additionalData.debtInUSD || 0) + (borrow + stableBorrow) * price;
        position.additionalData.collateralInUSD =
            (position.additionalData.collateralInUSD || 0) + balance * price;
        const assetsResult = [];
        const priceIn = { baseCurrency: 'usd', price };
        if (asset.balance > 0) {
            assetsResult.push({
                address: asset.address,
                symbol: asset.symbol,
                name: asset.name,
                iconUrl: '',
                decimals: Number(asset.decimals),
                amount: asset.balance,
                priceIn,
                value: (0, helpers_1.getAssetValue)(asset.balance, Number(asset.decimals), [priceIn]),
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
                iconUrl: '',
                decimals: Number(asset.decimals),
                amount: asset.stableBorrowAssetBalanc,
                priceIn,
                value: (0, helpers_1.getAssetValue)(asset.stableBorrowAssetBalanc, Number(asset.decimals), [priceIn]),
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
                iconUrl: '',
                decimals: Number(asset.decimals),
                amount: asset.borrowAssetBalance,
                priceIn,
                value: (0, helpers_1.getAssetValue)(asset.borrowAssetBalance, Number(asset.decimals), [priceIn]),
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
        source: 'custom',
        type: 'lending',
        positions: [position],
        iconUrl: '',
        siteUrl: 'https://app.aave.com/',
        positionInUSD: position.additionalData.positionInUSD
    };
}
//# sourceMappingURL=aaveV3.js.map