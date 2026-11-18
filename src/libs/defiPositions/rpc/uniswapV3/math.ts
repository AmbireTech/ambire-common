export function uniV3DataToPortfolioPosition(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  tickLow: bigint,
  tickHigh: bigint
) {
  const Q96: any = 2 ** 96

  function getTickAtSqrtPrice(sqrtPriceX96: number) {
    const tick = Math.floor(Math.log((sqrtPriceX96 / Q96) ** 2) / Math.log(1.0001))
    return tick
  }

  function getTokenAmounts(
    liquidity: number,
    sqrtPriceX96: number,
    tickLow: number,
    tickHigh: number
  ) {
    let isInRage = false
    const sqrtRatioA = Math.sqrt(1.0001 ** tickLow)
    const sqrtRatioB = Math.sqrt(1.0001 ** tickHigh)
    const currentTick = getTickAtSqrtPrice(sqrtPriceX96)

    const sqrtPrice = sqrtPriceX96 / Q96
    let amount0 = 0
    let amount1 = 0
    if (currentTick < tickLow) {
      isInRage = false
      amount0 = Math.floor(liquidity * ((sqrtRatioB - sqrtRatioA) / (sqrtRatioA * sqrtRatioB)))
    } else if (currentTick >= tickHigh) {
      isInRage = false
      amount1 = Math.floor(liquidity * (sqrtRatioB - sqrtRatioA))
    } else if (currentTick >= tickLow && currentTick < tickHigh) {
      isInRage = true
      amount0 = Math.floor(liquidity * ((sqrtRatioB - sqrtPrice) / (sqrtPrice * sqrtRatioB)))
      amount1 = Math.floor(liquidity * (sqrtPrice - sqrtRatioA))
    }
    return { amount0, amount1, isInRage }
  }

  return getTokenAmounts(Number(liquidity), Number(sqrtPriceX96), Number(tickLow), Number(tickHigh))
}
