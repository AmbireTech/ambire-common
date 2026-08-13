import { JsonRpcProvider, Provider } from 'ethers'

import DeFiPositionsDeploylessCode from '../../../../contracts/compiled/DeFiAAVEPosition.json'
import { Network } from '../../../interfaces/network'
import { generateUuid } from '../../../utils/uuid'
import { withTimeout } from '../../../utils/with-timeout'
import { fromDescriptor } from '../../deployless/deployless'
import { offload } from '../../offload/offload'
import { AAVE_V3 } from '../defiAddresses'
import { getAssetValue } from '../helpers'
import { AAVEAsset } from '../positionsProcessing'
import { AssetType, Position, PositionAsset, PositionsByProvider } from '../types'

const AAVE_NO_HEALTH_FACTOR_MAGIC_NUMBER =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n

const PAGE_SIZE = 12
export const AAVE_STATIC_CALL_TIMEOUT_MS = 15 * 1000

export async function getAAVEPositions(
  userAddr: string,
  provider: Provider | JsonRpcProvider,
  network: Network
): Promise<PositionsByProvider | null> {
  const { chainId } = network
  if (chainId && !AAVE_V3[chainId.toString() as keyof typeof AAVE_V3]) return null

  const { poolAddr } = AAVE_V3[chainId.toString() as keyof typeof AAVE_V3]

  const deploylessDeFiPositionsGetter = fromDescriptor(
    provider,
    DeFiPositionsDeploylessCode,
    network.rpcNoStateOverride // Why?
  )

  const fetchPage = async (from: number, to: number) => {
    const data = await deploylessDeFiPositionsGetter.callRaw(
      'getAAVEPosition',
      [userAddr, poolAddr, from, to],
      {}
    )

    return offload('processAAVEPositions', { data })
  }

  // The first page also returns the total reserves count, so the remaining
  // pages can be fetched in parallel without a separate count request first.
  const firstPage = await fetchPage(0, PAGE_SIZE)

  const remainingPageRanges: [number, number][] = []
  for (let from = PAGE_SIZE; from < firstPage.reservesCount; from += PAGE_SIZE) {
    remainingPageRanges.push([from, from + PAGE_SIZE])
  }
  const remainingPages = await Promise.all(
    remainingPageRanges.map(([from, to]) => fetchPage(from, to))
  )

  const userAssets: AAVEAsset[] = [firstPage, ...remainingPages].flatMap((page) => page.assets)

  const healthFactor =
    firstPage.healthFactor === AAVE_NO_HEALTH_FACTOR_MAGIC_NUMBER ? null : firstPage.healthFactor

  const position: Position = {
    id: generateUuid(),
    additionalData: {
      healthRate: healthFactor ? Number(healthFactor) / 1e18 : null,
      positionInUSD: 0,
      deptInUSD: 0,
      collateralInUSD: 0,
      availableBorrowInUSD: Number(firstPage.availableBorrowsBase) / 1e8,
      name: 'Lending'
    },
    assets: []
  }

  position.assets = userAssets
    .map((asset: any) => {
      const balance = Number(asset.balance) / 10 ** Number(asset.decimals)
      const price = Number(asset.price) / 1e8
      const borrow = (Number(asset.borrowAssetBalance) / 10 ** Number(asset.decimals)) * -1
      const stableBorrow =
        (Number(asset.stableBorrowAssetBalance) / 10 ** Number(asset.decimals)) * -1

      position.additionalData.positionInUSD =
        (position.additionalData.positionInUSD || 0) + (balance + borrow + stableBorrow) * price
      position.additionalData.debtInUSD =
        (position.additionalData.debtInUSD || 0) + (borrow + stableBorrow) * price
      position.additionalData.collateralInUSD =
        (position.additionalData.collateralInUSD || 0) + balance * price

      const assetsResult = []

      const priceIn = { baseCurrency: 'usd', price }

      if (asset.balance > 0) {
        assetsResult.push({
          address: asset.address,
          symbol: asset.symbol,
          name: asset.name,
          iconUrl: '',
          decimals: Number(asset.decimals),
          amount: asset.balance,
          priceIn,
          value: getAssetValue(asset.balance, Number(asset.decimals), [priceIn]),
          type: AssetType.Collateral,
          additionalData: {
            APY: Number(asset.currentLiquidityRate) / 10 ** 25
          },
          protocolAsset: {
            address: asset.aaveAddress,
            symbol: asset.aaveSymbol,
            name: asset.aaveName,
            decimals: asset.aaveDecimals
          }
        } as PositionAsset)
      }

      if (asset.stableBorrowAssetBalanc > 0) {
        assetsResult.push({
          address: asset.address,
          symbol: asset.symbol,
          name: asset.name,
          iconUrl: '',
          decimals: Number(asset.decimals),
          amount: asset.stableBorrowAssetBalanc,
          priceIn,
          value: getAssetValue(asset.stableBorrowAssetBalanc, Number(asset.decimals), [priceIn]),
          type: AssetType.Borrow,
          additionalData: {
            APY: Number(asset.currentStableBorrowRate) / 10 ** 25
          },
          protocolAsset: {
            address: asset.aaveSDebtAddr,
            symbol: asset.aaveSDebtSymbol,
            name: asset.aaveSDebtName,
            decimals: asset.aaveSDebtDecimals
          }
        } as PositionAsset)
      }

      if (asset.borrowAssetBalance > 0) {
        assetsResult.push({
          address: asset.address,
          symbol: asset.symbol,
          name: asset.name,
          iconUrl: '',
          decimals: Number(asset.decimals),
          amount: asset.borrowAssetBalance,
          priceIn,
          value: getAssetValue(asset.borrowAssetBalance, Number(asset.decimals), [priceIn]),
          type: AssetType.Borrow,
          additionalData: {
            APY: Number(asset.currentVariableBorrowRate) / 10 ** 25
          },
          protocolAsset: {
            address: asset.aaveVDebtAddr,
            symbol: asset.aaveVDebtSymbol,
            name: asset.name,
            decimals: asset.aaveVDebtDecimals
          }
        } as PositionAsset)
      }

      return assetsResult
    })
    .flat()

  if (position.additionalData.positionInUSD === 0 || !position.assets.length) return null

  return {
    providerName: 'AAVE v3',
    chainId,
    source: 'custom',
    type: 'lending',
    positions: [position],
    iconUrl: '',
    siteUrl: 'https://app.aave.com/',
    positionInUSD: position.additionalData.positionInUSD
  }
}
