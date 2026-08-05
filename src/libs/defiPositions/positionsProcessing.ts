import { decodeFunctionResult } from 'viem'

import DeFiAAVEPositionCode from '../../../contracts/compiled/DeFiAAVEPosition.json'
import DeFiUniswapV3PositionsCode from '../../../contracts/compiled/DeFiUniswapV3Positions.json'
import { uniV3DataToPortfolioPosition } from './providers/helpers/univ3Math'
import { AssetType, Position } from './types'

/** A single AAVE reserve the user actually holds, decoded from the contract. */
export type AAVEAsset = {
  address: string
  aaveAddress: string
  symbol: string
  name: string
  balance: bigint
  decimals: number
  price: bigint
  borrowAssetBalance: bigint
  stableBorrowAssetBalance: bigint
  currentLiquidityRate: bigint
  currentVariableBorrowRate: bigint
  currentStableBorrowRate: bigint
  aaveSymbol: string
  aaveName: string
  aaveDecimals: number
  aaveSDebtAddr: string
  aaveSDebtSymbol: string
  aaveSDebtName: string
  aaveSDebtDecimals: number
  aaveVDebtAddr: string
  aaveVDebtSymbol: string
  aaveVDebtName: string
  aaveVDebtDecimals: number
}

export type ProcessAAVEPositionsInput = {
  /** Raw hex return data from a single `getAAVEPosition` page call. */
  data: `0x${string}`
}

export type ProcessAAVEPositionsOutput = {
  /** Total reserves in the pool, so the caller knows how many pages to fetch. */
  reservesCount: number
  healthFactor: bigint
  availableBorrowsBase: bigint
  /** Only reserves with a non-zero collateral or borrow balance. */
  assets: AAVEAsset[]
}

export type ProcessUniV3PositionsInput = {
  /** Raw hex return data from `getUniV3Position`. */
  data: `0x${string}`
}

export type ProcessUniV3PositionsOutput = {
  positions: Position[]
}

function decode(abi: any, methodName: string, data: `0x${string}`): any {
  if (!data || data === '0x' || data.length < 4) {
    throw new Error(`empty or malformed return data for ${methodName}: ${data}`)
  }

  return decodeFunctionResult({ abi, functionName: methodName, data })
}

/**
 * Decodes one `getAAVEPosition` page and keeps only the reserves the user
 * holds. The per-asset USD math is left to the caller because it depends on
 * ethers, which the worklet runtime cannot load.
 */
export function processAAVEPositions(input: ProcessAAVEPositionsInput): ProcessAAVEPositionsOutput {
  const result = decode(DeFiAAVEPositionCode.abi, 'getAAVEPosition', input.data)

  const assets: AAVEAsset[] = result.userBalance
    .map(({ addr, ...rest }: any) => ({
      address: addr,
      aaveAddress: rest.aaveAddr,
      symbol: rest.symbol,
      name: rest.name,
      balance: rest.balance,
      decimals: Number(rest.decimals),
      price: rest.price,
      borrowAssetBalance: rest.borrowAssetBalance,
      stableBorrowAssetBalance: rest.stableBorrowAssetBalance,
      currentLiquidityRate: rest.currentLiquidityRate,
      currentVariableBorrowRate: rest.currentVariableBorrowRate,
      currentStableBorrowRate: rest.currentStableBorrowRate,
      aaveSymbol: rest.aaveSymbol,
      aaveName: rest.aaveName,
      aaveDecimals: Number(rest.aaveDecimals),
      aaveSDebtAddr: rest.aaveSDebtAddr,
      aaveSDebtSymbol: rest.aaveSDebtSymbol,
      aaveSDebtName: rest.aaveSDebtName,
      aaveSDebtDecimals: Number(rest.aaveSDebtDecimals),
      aaveVDebtAddr: rest.aaveVDebtAddr,
      aaveVDebtSymbol: rest.aaveVDebtSymbol,
      aaveVDebtName: rest.aaveVDebtName,
      aaveVDebtDecimals: Number(rest.aaveVDebtDecimals)
    }))
    .filter(
      (t: AAVEAsset) =>
        t.symbol !== 'error' &&
        t.name !== 'error' &&
        (t.balance > 0n || t.borrowAssetBalance > 0n || t.stableBorrowAssetBalance > 0n)
    )

  return {
    reservesCount: Number(result.reservesCount),
    healthFactor: result.accountData.healthFactor,
    availableBorrowsBase: result.accountData.availableBorrowsBase,
    assets
  }
}

/**
 * Decodes a `getUniV3Position` result into portfolio positions, discarding
 * positions with zero liquidity. All the math is pure, so the whole map runs
 * off the main thread.
 */
export function processUniV3Positions(
  input: ProcessUniV3PositionsInput
): ProcessUniV3PositionsOutput {
  const result = decode(DeFiUniswapV3PositionsCode.abi, 'getUniV3Position', input.data)

  const positions: Position[] = result
    .map((asset: any) => {
      const tokenAmounts = uniV3DataToPortfolioPosition(
        asset.positionInfo.liquidity,
        asset.poolSlot0.sqrtPriceX96,
        asset.positionInfo.tickLower,
        asset.positionInfo.tickUpper
      )

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
            type: AssetType.Liquidity
          },
          {
            address: asset.positionInfo.token1,
            symbol: asset.token1Symbol,
            name: asset.token1Name,
            decimals: Number(asset.token1Decimals),
            amount: BigInt(tokenAmounts.amount1),
            type: AssetType.Liquidity
          }
        ]
      }
    })
    .filter((p: Position) => p.additionalData.liquidity !== 0n)

  return { positions }
}
