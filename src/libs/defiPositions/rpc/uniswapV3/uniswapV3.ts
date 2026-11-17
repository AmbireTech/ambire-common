import { JsonRpcProvider, Provider } from 'ethers'

import DeFiPositionsDeploylessCode from '../../../../../contracts/compiled/DeFiUniswapV3Positions.json'
import { Network } from '../../../../interfaces/network'
import { fromDescriptor } from '../../../deployless/deployless'
import { AssetType, Position, PositionsByProvider } from '../../types'
import { RpcDefiProvider } from '../types'
import { UNISWAP_V3 } from './addresses'
import { uniV3DataToPortfolioPosition } from './math'

export const UNISWAP_V3_PROVIDER_NAME = 'Uniswap V3'

export async function getUniV3Positions(
  userAddr: string,
  provider: Provider | JsonRpcProvider,
  network: Network
): Promise<PositionsByProvider | null> {
  const { chainId } = network
  if (chainId && !UNISWAP_V3[chainId.toString() as keyof typeof UNISWAP_V3]) return null

  const { nonfungiblePositionManagerAddr, factoryAddr } =
    UNISWAP_V3[chainId.toString() as keyof typeof UNISWAP_V3]

  const deploylessDeFiPositionsGetter = fromDescriptor(
    provider,
    DeFiPositionsDeploylessCode,
    network.rpcNoStateOverride // Why?
  )
  const result = await deploylessDeFiPositionsGetter.call('getUniV3Position', [
    userAddr,
    nonfungiblePositionManagerAddr,
    factoryAddr
  ])

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

  if (positions.length === 0) return null

  return {
    providerName: UNISWAP_V3_PROVIDER_NAME,
    chainId,
    source: 'custom',
    iconUrl: '',
    siteUrl: 'https://app.uniswap.org/swap',
    type: 'common',
    positions
  }
}

/**
 * Merges the Uniswap V3 positions read from the chain into the ones returned by the API
 * (Debank), matching them by position index. The API data is kept (icons, prices, values),
 * enhanced with what only the chain has - whether the position is in range and its liquidity.
 * Positions found in only one of the two are kept as they are.
 */
export const mergeUniV3WithApiPositions = ({
  rpcPositions,
  apiPositions
}: {
  rpcPositions: PositionsByProvider
  apiPositions: PositionsByProvider
}): PositionsByProvider => {
  const positionsMap = new Map<string, Position>()

  rpcPositions.positions.forEach((customPos) => {
    if (!customPos.additionalData.positionIndex) return

    positionsMap.set(customPos.additionalData.positionIndex, customPos)
  })

  apiPositions.positions.forEach((debankPos) => {
    if (!debankPos.additionalData.positionIndex) return

    const existingPos = positionsMap.get(debankPos.additionalData.positionIndex)

    if (existingPos) {
      // Merge data if position exists in both
      positionsMap.set(debankPos.additionalData.positionIndex, {
        ...debankPos,
        additionalData: {
          ...debankPos.additionalData,
          inRange: existingPos.additionalData.inRange,
          liquidity: existingPos.additionalData.liquidity
        }
      })
    } else {
      // Add new Debank position
      positionsMap.set(debankPos.additionalData.positionIndex, debankPos)
    }
  })

  return {
    ...apiPositions,
    source: 'mixed' as const,
    positions: Array.from(positionsMap.values())
  }
}

export const uniswapV3DefiProvider = {
  name: UNISWAP_V3_PROVIDER_NAME,
  fetchPositions: ({ accountAddr, provider, network }) =>
    getUniV3Positions(accountAddr, provider, network),
  mergeWithApiPositions: mergeUniV3WithApiPositions
} satisfies RpcDefiProvider
