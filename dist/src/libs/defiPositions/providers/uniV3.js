"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUniV3Positions = getUniV3Positions;
exports.getDebankEnhancedUniV3Positions = getDebankEnhancedUniV3Positions;
const tslib_1 = require("tslib");
const DeFiUniswapV3Positions_json_1 = tslib_1.__importDefault(require("../../../../contracts/compiled/DeFiUniswapV3Positions.json"));
const deployless_1 = require("../../deployless/deployless");
const defiAddresses_1 = require("../defiAddresses");
const helpers_1 = require("../helpers");
const types_1 = require("../types");
const univ3Math_1 = require("./helpers/univ3Math");
async function getUniV3Positions(userAddr, provider, network) {
    const { chainId } = network;
    if (chainId && !defiAddresses_1.UNISWAP_V3[chainId.toString()])
        return null;
    const { nonfungiblePositionManagerAddr, factoryAddr } = defiAddresses_1.UNISWAP_V3[chainId.toString()];
    const deploylessDeFiPositionsGetter = (0, deployless_1.fromDescriptor)(provider, DeFiUniswapV3Positions_json_1.default, network.rpcNoStateOverride // Why?
    );
    const result = await deploylessDeFiPositionsGetter.call('getUniV3Position', [
        userAddr,
        nonfungiblePositionManagerAddr,
        factoryAddr
    ]);
    const positions = result
        .map((asset) => {
        const tokenAmounts = (0, univ3Math_1.uniV3DataToPortfolioPosition)(asset.positionInfo.liquidity, asset.poolSlot0.sqrtPriceX96, asset.positionInfo.tickLower, asset.positionInfo.tickUpper);
        return {
            id: asset.positionId.toString(),
            additionalData: {
                inRange: tokenAmounts.isInRage,
                positionIndex: asset.positionId.toString(),
                liquidity: asset.positionInfo.liquidity,
                name: 'Liquidity Pool',
                pool: { id: asset.poolAddr }
            },
            assets: [
                {
                    address: asset.positionInfo.token0,
                    symbol: asset.token0Symbol,
                    name: asset.token0Name,
                    decimals: Number(asset.token0Decimals),
                    amount: BigInt(tokenAmounts.amount0),
                    type: types_1.AssetType.Liquidity
                },
                {
                    address: asset.positionInfo.token1,
                    symbol: asset.token1Symbol,
                    name: asset.token1Name,
                    decimals: Number(asset.token1Decimals),
                    amount: BigInt(tokenAmounts.amount1),
                    type: types_1.AssetType.Liquidity
                }
            ]
        };
    })
        .filter((p) => p.additionalData.liquidity !== 0n);
    if (positions.length === 0)
        return null;
    return {
        providerName: 'Uniswap V3',
        chainId,
        source: 'custom',
        iconUrl: '',
        siteUrl: 'https://app.uniswap.org/swap',
        type: 'common',
        positions
    };
}
async function getDebankEnhancedUniV3Positions(addr, provider, network, previousPositions, debankNetworkPositionsByProvider, isDebankCallSuccessful) {
    const previousMixedUniV3 = previousPositions.find((p) => (0, helpers_1.getProviderId)(p.providerName) === (0, helpers_1.getProviderId)('Uniswap V3') && p.source === 'mixed');
    // If the call to debank wasn't successful, and we have a previous mixed UniV3 position, return it
    // This is done to avoid losing the mixed data in case of Debank being down
    // At the same time, we want to fetch the custom position if there is no previous mixed data
    if (!isDebankCallSuccessful && previousMixedUniV3) {
        return previousMixedUniV3;
    }
    const uniPosition = await getUniV3Positions(addr, provider, network);
    if (!uniPosition)
        return null;
    const uniPositionFromDebank = debankNetworkPositionsByProvider?.find((p) => (0, helpers_1.getProviderId)(p.providerName) === (0, helpers_1.getProviderId)(uniPosition.providerName));
    // If we can't find a matching UniV3 position from Debank, return the custom one
    if (!uniPositionFromDebank)
        return uniPosition;
    // Merge the positions from Debank with the custom ones
    const positionsMap = new Map();
    uniPosition.positions.forEach((customPos) => {
        if (!customPos.additionalData.positionIndex)
            return;
        positionsMap.set(customPos.additionalData.positionIndex, customPos);
    });
    uniPositionFromDebank.positions.forEach((debankPos) => {
        if (!debankPos.additionalData.positionIndex)
            return;
        const existingPos = positionsMap.get(debankPos.additionalData.positionIndex);
        if (existingPos) {
            // Merge data if position exists in both
            positionsMap.set(debankPos.additionalData.positionIndex, {
                ...debankPos,
                additionalData: {
                    ...debankPos.additionalData,
                    inRange: existingPos.additionalData.inRange,
                    liquidity: existingPos.additionalData.liquidity
                }
            });
        }
        else {
            // Add new Debank position
            positionsMap.set(debankPos.additionalData.positionIndex, debankPos);
        }
    });
    const mergedPositions = Array.from(positionsMap.values());
    return {
        ...uniPositionFromDebank,
        source: 'mixed',
        positions: mergedPositions
    };
}
//# sourceMappingURL=uniV3.js.map