import { JsonRpcProvider, Provider } from 'ethers'

import DeFiPositionsDeploylessCode from '../../../../contracts/compiled/DeFiUniswapV3Positions.json'
import { Network } from '../../../interfaces/network'
import { RPCProvider } from '../../../interfaces/provider'
import { fromDescriptor } from '../../deployless/deployless'
import { offload } from '../../offload/offload'
import { UNISWAP_V3 } from '../defiAddresses'
import { getProviderId } from '../helpers'
import { Position, PositionsByProvider } from '../types'

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
  const data = await deploylessDeFiPositionsGetter.callRaw('getUniV3Position', [
    userAddr,
    nonfungiblePositionManagerAddr,
    factoryAddr
  ])

  const { positions } = await offload('processUniV3Positions', { data })

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
