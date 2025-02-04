import { v4 as uuidv4 } from 'uuid';
import DeFiPositionsDeploylessCode from '../../../../contracts/compiled/DeFiAAVEPosition.json';
import { fromDescriptor } from '../../deployless/deployless';
import { AAVE_V3 } from '../defiAddresses';
import { getAssetValue } from '../helpers';
import { AssetType } from '../types';
const AAVE_NO_HEALTH_FACTOR_MAGIC_NUMBER = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
export async function getAAVEPositions(userAddr, provider, network) {
    const networkId = network.id;
    if (networkId && !AAVE_V3[networkId])
        return null;
    const { poolAddr } = AAVE_V3[networkId];
    const deploylessDeFiPositionsGetter = fromDescriptor(provider, DeFiPositionsDeploylessCode, network.rpcNoStateOverride);
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
        balance: asset[2],
        decimals: asset[3],
        price: asset[4],
        borrowAssetBalance: asset[5],
        stableBorrowAssetBalance: asset[6],
        currentLiquidityRate: asset[7],
        currentVariableBorrowRate: asset[8],
        currentStableBorrowRate: asset[9],
        aaveAddress: asset[10],
        aaveSymbol: asset[11],
        aaveDecimals: asset[12],
        aaveSDebtAddr: asset[13],
        aaveSDebtSymbol: asset[14],
        aaveSDebtDecimals: asset[15],
        aaveVDebtAddr: asset[16],
        aaveVDebtSymbol: asset[17],
        aaveVDebtDecimals: asset[18]
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
        id: uuidv4(),
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
                decimals: Number(asset.decimals),
                amount: asset.balance,
                priceIn,
                value: getAssetValue(asset.balance, Number(asset.decimals), priceIn),
                type: AssetType.Collateral,
                additionalData: {
                    APY: Number(asset.currentLiquidityRate) / 10 ** 25
                },
                protocolAsset: {
                    address: asset.aaveAddress,
                    symbol: asset.aaveSymbol,
                    decimals: asset.aaveDecimals
                }
            });
        }
        if (asset.stableBorrowAssetBalanc > 0) {
            assetsResult.push({
                address: asset.address,
                symbol: asset.symbol,
                decimals: Number(asset.decimals),
                amount: asset.stableBorrowAssetBalanc,
                priceIn,
                value: getAssetValue(asset.stableBorrowAssetBalanc, Number(asset.decimals), priceIn),
                type: AssetType.Borrow,
                additionalData: {
                    APY: Number(asset.currentStableBorrowRate) / 10 ** 25
                },
                protocolAsset: {
                    address: asset.aaveSDebtAddr,
                    symbol: asset.aaveSDebtSymbol,
                    decimals: asset.aaveSDebtDecimals
                }
            });
        }
        if (asset.borrowAssetBalance > 0) {
            assetsResult.push({
                address: asset.address,
                symbol: asset.symbol,
                decimals: Number(asset.decimals),
                amount: asset.borrowAssetBalance,
                priceIn,
                value: getAssetValue(asset.borrowAssetBalance, Number(asset.decimals), priceIn),
                type: AssetType.Borrow,
                additionalData: {
                    APY: Number(asset.currentVariableBorrowRate) / 10 ** 25
                },
                protocolAsset: {
                    address: asset.aaveVDebtAddr,
                    symbol: asset.aaveVDebtSymbol,
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
        networkId,
        type: 'lending',
        positions: [position],
        positionInUSD: position.additionalData.positionInUSD
    };
}
//# sourceMappingURL=aaveV3.js.map