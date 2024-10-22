import { JsonRpcProvider, Provider } from 'ethers'
import DeFiPositionsDeploylessCode from '../../../contracts/compiled/DeFiAAVEPosition.json'
import { Network } from '../../interfaces/network'
import { Deployless, fromDescriptor } from '../deployless/deployless'
import { AAVE_V3 } from './defiAddresses'
import { Positions, AssetType } from './types'

export async function getAAVEPositions(
    userAddr: string,
    provider: Provider | JsonRpcProvider,
    network: Network
): Promise <Positions[] | null> {
    const networkId = network.id
    if (networkId && !AAVE_V3[networkId as keyof typeof AAVE_V3]) return null

    const { poolAddr } = AAVE_V3[networkId as keyof typeof AAVE_V3]
    const deploylessDeFiPositionsGetter = fromDescriptor(provider, DeFiPositionsDeploylessCode, network.rpcNoStateOverride)
    const [result] = await deploylessDeFiPositionsGetter.call('getAAVEPosition',[userAddr, poolAddr],{})
    const [assets, accountDataRes, assetsErr, accountDataErr] = result

    const userAssets = assets.map((asset: any) => ({
        symbol: asset[0],
        balance: asset[1],
        decimals: asset[2],
        price: asset[3],
        borrowAssetBalance: asset[4], 
        stableBorrowAssetBalance: asset[5],
        currentLiquidityRate: asset[6],
        currentVariableBorrowRate: asset[7],
        currentStableBorrowRate: asset[8],
    })).filter((t: any) => t.balance > 0 || t.borrowAssetBalance > 0 || t.stableBorrowAssetBalance > 0)
    
    const accountData = {
        totalCollateralBase: accountDataRes[0],
        totalDebtBase: accountDataRes[1],
        availableBorrowsBase: accountDataRes[2],
        currentLiquidationThreshold: accountDataRes[3],
        ltv: accountDataRes[4],
        healthFactor:accountDataRes[5]
    }

    const positions: Positions[] = [
        {
            providerName: 'AAVE v3',
            positionType: 'Lending',
            additionalData:{
                healthRate: Number(accountData.healthFactor)/1e18,
                positionInUSD: 0,
                deptInUSD: 0,
                collateralInUSD: 0,
                availableBorrowInUSD: Number(accountData.availableBorrowsBase) / 1e8
            },
            network: network.name,
            assets: []
        }
    ]

    positions[0].assets = userAssets.map((asset: any) => {
        const balance = Number(asset.balance) / (10 ** Number(asset.decimals))
        const price = Number(asset.price) / (1e8)
        const borrow = (Number(asset.borrowAssetBalance) / (10 ** Number(asset.decimals))) * -1
        const stableBorrow = (Number(asset.stableBorrowAssetBalance) / (10 ** Number(asset.decimals))) * -1
        
        positions[0].additionalData.positionInUSD += ((balance + borrow + stableBorrow) * price)
        positions[0].additionalData.deptInUSD += (borrow * price)
        positions[0].additionalData.deptInUSD += (stableBorrow * price)
        positions[0].additionalData.collateralInUSD += (balance * price)

        return {
            symbol: asset.symbol,
            decimals: asset.decimals,
            amount: asset.balance || asset.borrowAssetBalance || asset.stableBorrowAssetBalance,
            type: asset.balance > 0 ? AssetType.Collateral : AssetType.Borrow,
            additionalData: {
                APY: asset.balance > 0 ? Number(asset.currentLiquidityRate) / 10 ** 25 : Number(asset.currentVariableBorrowRate) / 10 ** 25
            }
        }
    })

    positions[0].additionalData.positionInUSD === 0 ? positions[0].additionalData.healthRate = 10 : null
    return positions
}


