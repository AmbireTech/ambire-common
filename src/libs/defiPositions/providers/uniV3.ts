import { JsonRpcProvider, Provider } from 'ethers'

import DeFiPositionsDeploylessCode from '../../../../contracts/compiled/DeFiUniswapV3Positions.json'
import { Network } from '../../../interfaces/network'
import { RPCProvider } from '../../../interfaces/provider'
import { fromDescriptor } from '../../deployless/deployless'
import { UNISWAP_V3 } from '../defiAddresses'
import { getProviderId } from '../helpers'
import { AssetType, Position, PositionsByProvider } from '../types'
import { uniV3DataToPortfolioPosition } from './helpers/univ3Math'

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
    providerName: 'Uniswap V3',
    chainId,
    source: 'custom',
    iconUrl: '',
    siteUrl: 'https://app.uniswap.org/swap',
    type: 'common',
    positions
  }
}

export async function getDebankEnhancedUniV3Positions(
  addr: string,
  provider: RPCProvider,
  network: Network,
  previousPositions: PositionsByProvider[],
  debankNetworkPositionsByProvider: PositionsByProvider[],
  isDebankCallSuccessful: boolean
): Promise<PositionsByProvider | null> {
  const previousMixedUniV3 = previousPositions.find(
    (p) => getProviderId(p.providerName) === getProviderId('Uniswap V3') && p.source === 'mixed'
  )

  // If the call to debank wasn't successful, and we have a previous mixed UniV3 position, return it
  // This is done to avoid losing the mixed data in case of Debank being down
  // At the same time, we want to fetch the custom position if there is no previous mixed data
  if (!isDebankCallSuccessful && previousMixedUniV3) {
    return previousMixedUniV3
  }

  const uniPosition = await getUniV3Positions(addr, provider, network)

  if (!uniPosition) return null

  const uniPositionFromDebank = debankNetworkPositionsByProvider?.find(
    (p) => getProviderId(p.providerName) === getProviderId(uniPosition.providerName)
  )

  // If we can't find a matching UniV3 position from Debank, return the custom one
  if (!uniPositionFromDebank) return uniPosition

  // Merge the positions from Debank with the custom ones
  const positionsMap = new Map<string, Position>()

  uniPosition.positions.forEach((customPos) => {
    if (!customPos.additionalData.positionIndex) return

    positionsMap.set(customPos.additionalData.positionIndex, customPos)
  })

  uniPositionFromDebank.positions.forEach((debankPos) => {
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
  const mergedPositions = Array.from(positionsMap.values())

  return {
    ...uniPositionFromDebank,
    source: 'mixed' as const,
    positions: mergedPositions
  }
}
