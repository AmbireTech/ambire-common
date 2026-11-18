// A port of the parts of Morpho Blue's MathLib, SharesMathLib and MorphoBalancesLib that are
// needed to turn a position's shares into token amounts, with the interest accrued since the
// market was last updated (the market totals stored on-chain are as of `lastUpdate`).
// https://github.com/morpho-org/morpho-blue/tree/main/src/libraries

const WAD = 10n ** 18n

/** The scale of the price returned by a Morpho oracle (see Morpho Blue's `IOracle`) */
const ORACLE_PRICE_SCALE = 10n ** 36n

// Virtual shares and assets protect against share price manipulation (see SharesMathLib)
const VIRTUAL_SHARES = 10n ** 6n
const VIRTUAL_ASSETS = 1n

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60

/** The totals of a Morpho Blue market, as returned by `Morpho.market(id)` */
export type MorphoMarketTotals = {
  totalSupplyAssets: bigint
  totalSupplyShares: bigint
  totalBorrowAssets: bigint
  totalBorrowShares: bigint
  lastUpdate: bigint
  /** The share of the interest that goes to the fee recipient, scaled by 1e18 */
  fee: bigint
}

const mulDivDown = (x: bigint, y: bigint, d: bigint): bigint => (x * y) / d

const mulDivUp = (x: bigint, y: bigint, d: bigint): bigint => (x * y + (d - 1n)) / d

const wMulDown = (x: bigint, y: bigint): bigint => mulDivDown(x, y, WAD)

/** Approximates `e^(x * n) - 1` with the first three terms of its Taylor series, like Morpho does */
const wTaylorCompounded = (x: bigint, n: bigint): bigint => {
  const firstTerm = x * n
  const secondTerm = mulDivDown(firstTerm, firstTerm, 2n * WAD)
  const thirdTerm = mulDivDown(secondTerm, firstTerm, 3n * WAD)

  return firstTerm + secondTerm + thirdTerm
}

const toSharesDown = (assets: bigint, totalAssets: bigint, totalShares: bigint): bigint =>
  mulDivDown(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS)

const toAssetsDown = (shares: bigint, totalAssets: bigint, totalShares: bigint): bigint =>
  mulDivDown(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES)

const toAssetsUp = (shares: bigint, totalAssets: bigint, totalShares: bigint): bigint =>
  mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES)

/**
 * Returns the market totals with the interest accrued from `lastUpdate` until `timestamp`,
 * the same way `Morpho.accrueInterest` would. Without a borrow rate (e.g. the interest rate
 * model call failed) the totals are returned as they are.
 */
const getMorphoMarketTotalsWithAccruedInterest = (
  market: MorphoMarketTotals,
  borrowRate: bigint | null,
  timestamp: bigint
): MorphoMarketTotals => {
  const elapsed = timestamp - market.lastUpdate
  if (elapsed <= 0n || market.totalBorrowAssets === 0n || borrowRate === null) return market

  const interest = wMulDown(market.totalBorrowAssets, wTaylorCompounded(borrowRate, elapsed))
  const totalSupplyAssets = market.totalSupplyAssets + interest
  let { totalSupplyShares } = market

  if (market.fee !== 0n) {
    const feeAmount = wMulDown(interest, market.fee)
    totalSupplyShares += toSharesDown(feeAmount, totalSupplyAssets - feeAmount, totalSupplyShares)
  }

  return {
    ...market,
    totalSupplyAssets,
    totalSupplyShares,
    totalBorrowAssets: market.totalBorrowAssets + interest,
    lastUpdate: timestamp
  }
}

/** The amount of loan tokens that supply shares are worth (rounded down, like Morpho) */
const getMorphoSupplyAssets = (supplyShares: bigint, market: MorphoMarketTotals): bigint =>
  toAssetsDown(supplyShares, market.totalSupplyAssets, market.totalSupplyShares)

/** The amount of loan tokens owed for borrow shares (rounded up, like Morpho) */
const getMorphoBorrowAssets = (borrowShares: bigint, market: MorphoMarketTotals): bigint =>
  toAssetsUp(borrowShares, market.totalBorrowAssets, market.totalBorrowShares)

/**
 * The value of an amount of collateral in loan tokens, by the market's oracle price
 * (the price of 1 collateral token in loan tokens, scaled by 1e36).
 */
const getMorphoCollateralInLoanToken = (collateral: bigint, oraclePrice: bigint): bigint =>
  mulDivDown(collateral, oraclePrice, ORACLE_PRICE_SCALE)

/**
 * The health rate of a borrow position: how many times the debt could grow before the
 * position can be liquidated. Below 1 the position can be liquidated.
 * Returns null when there is no debt, as the position can't be liquidated then.
 */
const getMorphoHealthRate = ({
  collateral,
  borrowAssets,
  oraclePrice,
  lltv
}: {
  collateral: bigint
  borrowAssets: bigint
  /** The price of 1 collateral token in loan tokens, scaled by 1e36 */
  oraclePrice: bigint
  /** The loan-to-value at which the position can be liquidated, scaled by 1e18 */
  lltv: bigint
}): number | null => {
  if (borrowAssets === 0n) return null

  const maxBorrow = wMulDown(getMorphoCollateralInLoanToken(collateral, oraclePrice), lltv)

  // Keep 4 decimals of precision before converting to a number
  return Number((maxBorrow * 10_000n) / borrowAssets) / 10_000
}

/**
 * The yearly borrow and supply rates in percent, compounded every second.
 * The supply rate is lower, as only the borrowed part of the supply earns interest
 * and the fee recipient takes `fee` of it.
 */
const getMorphoApys = (
  borrowRate: bigint,
  market: MorphoMarketTotals
): { borrowApy: number; supplyApy: number } => {
  const borrowApy = Math.expm1((Number(borrowRate) / Number(WAD)) * SECONDS_PER_YEAR)
  const utilization =
    market.totalSupplyAssets === 0n
      ? 0
      : Number(market.totalBorrowAssets) / Number(market.totalSupplyAssets)
  const supplyApy = borrowApy * utilization * (1 - Number(market.fee) / Number(WAD))

  return { borrowApy: borrowApy * 100, supplyApy: supplyApy * 100 }
}

export {
  getMorphoApys,
  getMorphoBorrowAssets,
  getMorphoCollateralInLoanToken,
  getMorphoHealthRate,
  getMorphoMarketTotalsWithAccruedInterest,
  getMorphoSupplyAssets
}
