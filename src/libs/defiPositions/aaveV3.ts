import { JsonRpcProvider, Provider } from 'ethers'
import { v4 as uuidv4 } from 'uuid'

import DeFiPositionsDeploylessCode from '../../../contracts/compiled/DeFiAAVEPosition.json'
import { Network } from '../../interfaces/network'
import { fromDescriptor } from '../deployless/deployless'
import { AAVE_V3 } from './defiAddresses'
import { AssetType, PositionAsset, PositionsByProvider } from './types'

const AAVE_NO_HEALTH_FACTOR_MAGIC_NUMBER =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n

export async function getAAVEPositions(
  userAddr: string,
  provider: Provider | JsonRpcProvider,
  network: Network
): Promise<PositionsByProvider | null> {
  const networkId = network.id
  if (networkId && !AAVE_V3[networkId as keyof typeof AAVE_V3]) return null

  const { poolAddr } = AAVE_V3[networkId as keyof typeof AAVE_V3]
  const deploylessDeFiPositionsGetter = fromDescriptor(
    provider,
    DeFiPositionsDeploylessCode,
    network.rpcNoStateOverride
  )
  const [result] = await deploylessDeFiPositionsGetter.call(
    'getAAVEPosition',
    [userAddr, poolAddr],
    {}
  )
  const [assets, accountDataRes, assetsErr, accountDataErr] = result

  const userAssets = assets
    .map((asset: any) => ({
      address: asset[0],
      symbol: asset[1],
      balance: asset[2],
      decimals: asset[3],
      price: asset[4],
      borrowAssetBalance: asset[5],
      stableBorrowAssetBalance: asset[6],
      currentLiquidityRate: asset[7],
      currentVariableBorrowRate: asset[8],
      currentStableBorrowRate: asset[9]
    }))
    .filter((t: any) => t.balance > 0 || t.borrowAssetBalance > 0 || t.stableBorrowAssetBalance > 0)

  const accountData = {
    totalCollateralBase: accountDataRes[0],
    totalDebtBase: accountDataRes[1],
    availableBorrowsBase: accountDataRes[2],
    currentLiquidationThreshold: accountDataRes[3],
    ltv: accountDataRes[4],
    healthFactor: accountDataRes[5]
  }

  if (accountData.healthFactor === AAVE_NO_HEALTH_FACTOR_MAGIC_NUMBER) {
    accountData.healthFactor = null
  }

  const position = {
    id: uuidv4(),
    additionalData: {
      healthRate: accountData.healthFactor ? Number(accountData.healthFactor) / 1e18 : null,
      positionInUSD: 0,
      deptInUSD: 0,
      collateralInUSD: 0,
      availableBorrowInUSD: Number(accountData.availableBorrowsBase) / 1e8
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

      position.additionalData.positionInUSD += (balance + borrow + stableBorrow) * price
      position.additionalData.deptInUSD += borrow * price
      position.additionalData.deptInUSD += stableBorrow * price
      position.additionalData.collateralInUSD += balance * price

      const assetsResult = []

      if (asset.balance > 0) {
        assetsResult.push({
          address: asset.address,
          symbol: asset.symbol,
          decimals: Number(asset.decimals),
          amount: asset.balance,
          priceIn: [{ baseCurrency: 'usd', price }],
          type: AssetType.Collateral,
          additionalData: {
            APY: Number(asset.currentLiquidityRate) / 10 ** 25
          }
        } as PositionAsset)
      }

      if (asset.stableBorrowAssetBalanc > 0) {
        assetsResult.push({
          address: asset.address,
          symbol: asset.symbol,
          decimals: Number(asset.decimals),
          amount: asset.stableBorrowAssetBalanc,
          priceIn: [{ baseCurrency: 'usd', price }],
          type: AssetType.Borrow,
          additionalData: {
            APY: Number(asset.currentStableBorrowRate) / 10 ** 25
          }
        } as PositionAsset)
      }

      if (asset.borrowAssetBalance > 0) {
        assetsResult.push({
          address: asset.address,
          symbol: asset.symbol,
          decimals: Number(asset.decimals),
          amount: asset.borrowAssetBalance,
          priceIn: [{ baseCurrency: 'usd', price }],
          type: AssetType.Borrow,
          additionalData: {
            APY: Number(asset.currentVariableBorrowRate) / 10 ** 25
          }
        } as PositionAsset)
      }

      return assetsResult
    })
    .flat()

  if (position.additionalData.positionInUSD === 0 || !position.assets.length) return null

  return {
    providerName: 'AAVE v3',
    networkId,
    type: 'lending',
    positions: [position],
    positionInUSD: position.additionalData.positionInUSD
  }
}
