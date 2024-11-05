import { JsonRpcProvider, Provider } from 'ethers'
import { v4 as uuidv4 } from 'uuid'

import DeFiPositionsDeploylessCode from '../../../contracts/compiled/DeFiAAVEPosition.json'
import { Network } from '../../interfaces/network'
import { fromDescriptor } from '../deployless/deployless'
import { AAVE_V3 } from './defiAddresses'
import { AssetType, Position, PositionAsset } from './types'

const AAVE_NO_HEALTH_FACTOR_MAGIC_NUMBER =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n

export async function getAAVEPositions(
  userAddr: string,
  provider: Provider | JsonRpcProvider,
  network: Network
): Promise<Position[] | null> {
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

  let positions: Position[] = [
    {
      providerName: 'AAVE v3',
      positionType: 'Lending',
      additionalData: {
        positionId: uuidv4(),
        healthRate: accountData.healthFactor ? Number(accountData.healthFactor) / 1e18 : null,
        positionInUSD: 0,
        deptInUSD: 0,
        collateralInUSD: 0,
        availableBorrowInUSD: Number(accountData.availableBorrowsBase) / 1e8
      },
      networkId: network.id,
      assets: []
    }
  ]

  positions[0].assets = userAssets.map((asset: any) => {
    const balance = Number(asset.balance) / 10 ** Number(asset.decimals)
    const price = Number(asset.price) / 1e8
    const borrow = (Number(asset.borrowAssetBalance) / 10 ** Number(asset.decimals)) * -1
    const stableBorrow =
      (Number(asset.stableBorrowAssetBalance) / 10 ** Number(asset.decimals)) * -1

    positions[0].additionalData.positionInUSD += (balance + borrow + stableBorrow) * price
    positions[0].additionalData.deptInUSD += borrow * price
    positions[0].additionalData.deptInUSD += stableBorrow * price
    positions[0].additionalData.collateralInUSD += balance * price

    return {
      address: asset.address,
      symbol: asset.symbol,
      decimals: Number(asset.decimals),
      amount: asset.balance || asset.borrowAssetBalance || asset.stableBorrowAssetBalance,
      priceIn: [{ baseCurrency: 'usd', price }],
      type: asset.balance > 0 ? AssetType.Collateral : AssetType.Borrow,
      additionalData: {
        APY:
          asset.balance > 0
            ? Number(asset.currentLiquidityRate) / 10 ** 25
            : Number(asset.currentVariableBorrowRate) / 10 ** 25
      }
    } as PositionAsset
  })

  positions = positions.filter((p) => p.additionalData.positionInUSD !== 0)

  return positions.length ? positions : null
}
