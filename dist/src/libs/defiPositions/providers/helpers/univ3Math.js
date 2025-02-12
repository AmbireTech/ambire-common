"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uniV3DataToPortfolioPosition = void 0;
function uniV3DataToPortfolioPosition(liquidity, sqrtPriceX96, tickLow, tickHigh) {
    const Q96 = 2 ** 96;
    function getTickAtSqrtPrice(sqrtPriceX96) {
        const tick = Math.floor(Math.log((sqrtPriceX96 / Q96) ** 2) / Math.log(1.0001));
        return tick;
    }
    function getTokenAmounts(liquidity, sqrtPriceX96, tickLow, tickHigh) {
        let isInRage = false;
        const sqrtRatioA = Math.sqrt(1.0001 ** tickLow);
        const sqrtRatioB = Math.sqrt(1.0001 ** tickHigh);
        const currentTick = getTickAtSqrtPrice(sqrtPriceX96);
        const sqrtPrice = sqrtPriceX96 / Q96;
        let amount0 = 0;
        let amount1 = 0;
        if (currentTick < tickLow) {
            isInRage = false;
            amount0 = Math.floor(liquidity * ((sqrtRatioB - sqrtRatioA) / (sqrtRatioA * sqrtRatioB)));
        }
        else if (currentTick >= tickHigh) {
            isInRage = false;
            amount1 = Math.floor(liquidity * (sqrtRatioB - sqrtRatioA));
        }
        else if (currentTick >= tickLow && currentTick < tickHigh) {
            isInRage = true;
            amount0 = Math.floor(liquidity * ((sqrtRatioB - sqrtPrice) / (sqrtPrice * sqrtRatioB)));
            amount1 = Math.floor(liquidity * (sqrtPrice - sqrtRatioA));
        }
        return { amount0, amount1, isInRage };
    }
    return getTokenAmounts(Number(liquidity), Number(sqrtPriceX96), Number(tickLow), Number(tickHigh));
}
exports.uniV3DataToPortfolioPosition = uniV3DataToPortfolioPosition;
//# sourceMappingURL=univ3Math.js.map