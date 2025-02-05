"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUniV3Positions = void 0;
const tslib_1 = require("tslib");
const DeFiUniswapV3Positions_json_1 = tslib_1.__importDefault(require("../../../../contracts/compiled/DeFiUniswapV3Positions.json"));
const deployless_1 = require("../../deployless/deployless");
const defiAddresses_1 = require("../defiAddresses");
const types_1 = require("../types");
const univ3Math_1 = require("./helpers/univ3Math");
async function getUniV3Positions(userAddr, provider, network) {
    const networkId = network.id;
    if (networkId && !defiAddresses_1.UNISWAP_V3[networkId])
        return null;
    const { nonfungiblePositionManagerAddr, factoryAddr } = defiAddresses_1.UNISWAP_V3[networkId];
    const deploylessDeFiPositionsGetter = (0, deployless_1.fromDescriptor)(provider, DeFiUniswapV3Positions_json_1.default, network.rpcNoStateOverride);
    const [result] = await deploylessDeFiPositionsGetter.call('getUniV3Position', [
        userAddr,
        nonfungiblePositionManagerAddr,
        factoryAddr
    ]);
    const data = result.map((asset) => ({
        positionId: asset.positionId,
        token0Symbol: asset.token0Symbol,
        token0Decimals: asset.token0Decimals,
        token1Symbol: asset.token1Symbol,
        token1Decimals: asset.token1Decimals,
        feeGrowthGlobal0X128: asset.feeGrowthGlobal0X128,
        positionInfo: {
            nonce: asset.positionInfo.nonce,
            operator: asset.positionInfo.operator,
            token0: asset.positionInfo.token0,
            token1: asset.positionInfo.token1,
            fee: asset.positionInfo.fee,
            tickLower: asset.positionInfo.tickLower,
            tickUpper: asset.positionInfo.tickUpper,
            liquidity: asset.positionInfo.liquidity,
            feeGrowthInside0LastX128: asset.positionInfo.feeGrowthInside0LastX128,
            feeGrowthInside1LastX128: asset.positionInfo.feeGrowthInside1LastX128,
            tokensOwed0: asset.positionInfo.tokensOwed0,
            tokensOwed1: asset.positionInfo.tokensOwed1
        },
        poolSlot0: {
            sqrtPriceX96: asset.poolSlot0.sqrtPriceX96,
            tick: asset.poolSlot0.tick,
            observationIndex: asset.poolSlot0.observationIndex,
            observationCardinality: asset.poolSlot0.observationCardinality,
            observationCardinalityNext: asset.poolSlot0.observationCardinalityNext,
            feeProtocol: asset.poolSlot0.feeProtocol,
            unlocked: asset.poolSlot0.unlocked
        }
    }));
    const positions = data
        .map((pos) => {
        const tokenAmounts = (0, univ3Math_1.uniV3DataToPortfolioPosition)(pos.positionInfo.liquidity, pos.poolSlot0.sqrtPriceX96, pos.positionInfo.tickLower, pos.positionInfo.tickUpper);
        return {
            id: pos.positionId.toString(),
            additionalData: {
                inRange: tokenAmounts.isInRage,
                liquidity: pos.positionInfo.liquidity
            },
            assets: [
                {
                    address: pos.positionInfo.token0,
                    symbol: pos.token0Symbol,
                    decimals: Number(pos.token0Decimals),
                    amount: BigInt(tokenAmounts.amount0),
                    type: types_1.AssetType.Liquidity
                },
                {
                    address: pos.positionInfo.token1,
                    symbol: pos.token1Symbol,
                    decimals: Number(pos.token1Decimals),
                    amount: BigInt(tokenAmounts.amount1),
                    type: types_1.AssetType.Liquidity
                }
            ]
        };
    })
        .filter((p) => p.additionalData.liquidity !== BigInt(0));
    if (positions.length === 0)
        return null;
    return {
        providerName: 'Uniswap V3',
        networkId,
        type: 'liquidity-pool',
        positions
    };
}
exports.getUniV3Positions = getUniV3Positions;
//# sourceMappingURL=uniV3.js.map