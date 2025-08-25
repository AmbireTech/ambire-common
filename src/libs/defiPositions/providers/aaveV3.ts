import { JsonRpcProvider, Provider } from 'ethers'

import DeFiPositionsDeploylessCode from '../../../../contracts/compiled/DeFiAAVEPosition.json'
import { Network } from '../../../interfaces/network'
import { generateUuid } from '../../../utils/uuid'
import { fromDescriptor } from '../../deployless/deployless'
import { AAVE_V3 } from '../defiAddresses'
import { getAssetValue } from '../helpers'
import { AssetType, Position, PositionAsset, PositionsByProvider } from '../types'

const AAVE_NO_HEALTH_FACTOR_MAGIC_NUMBER =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n

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
  const [result0, result1, result2] = await Promise.all([
    deploylessDeFiPositionsGetter.call('getAAVEPosition', [userAddr, poolAddr, 0, 15], {}),
    deploylessDeFiPositionsGetter.call('getAAVEPosition', [userAddr, poolAddr, 15, 30], {}),
    deploylessDeFiPositionsGetter.call('getAAVEPosition', [userAddr, poolAddr, 30, 45], {})
  ])

  const accountData = result0.accountData

  const userAssets = [...result0.userBalance, ...result1.userBalance, ...result2.userBalance]
    .map(({ addr, ...rest }) => ({
      address: addr,
      aaveAddress: rest.aaveAddr,
      ...rest
    }))
    .filter((t: any) => t.balance > 0 || t.borrowAssetBalance > 0 || t.stableBorrowAssetBalance > 0)

  console.log('Debug: userAssets', userAssets, accountData)

  if (accountData.healthFactor === AAVE_NO_HEALTH_FACTOR_MAGIC_NUMBER) {
    accountData.healthFactor = null
  }

  const position = {
    id: generateUuid(),
    additionalData: {
      healthRate: accountData.healthFactor ? Number(accountData.healthFactor) / 1e18 : null,
      positionInUSD: 0,
      deptInUSD: 0,
      collateralInUSD: 0,
      availableBorrowInUSD: Number(accountData.availableBorrowsBase) / 1e8,
      name: 'Lending'
    },
    assets: []
  } as Position

  position.assets = userAssets
    .map((asset: any) => {
      const balance = Number(asset.balance) / 10 ** Number(asset.decimals)
      const price = Number(asset.price) / 1e8
      const borrow = (Number(asset.borrowAssetBalance) / 10 ** Number(asset.decimals)) * -1
      const stableBorrow =
        (Number(asset.stableBorrowAssetBalance) / 10 ** Number(asset.decimals)) * -1

      position.additionalData.positionInUSD += (balance + borrow + stableBorrow) * price
      position.additionalData.deptInUSD += borrow * price
      position.additionalData.deptInUSD += stableBorrow * price
      position.additionalData.collateralInUSD += balance * price

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
    type: 'lending',
    positions: [position],
    iconUrl: '',
    siteUrl: 'https://app.aave.com/',
    positionInUSD: position.additionalData.positionInUSD
  }
}
