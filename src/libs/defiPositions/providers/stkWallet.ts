import { TokenResult } from '../../portfolio'
import { getAssetValue } from '../helpers'
import { AssetType, Position, PositionAsset, PositionsByProvider } from '../types'

export function getStakedWalletPositions(stkWallet?: TokenResult): PositionsByProvider | null {
  if (!stkWallet || !stkWallet.amount) return null

  const positionInUSD = getAssetValue(
    BigInt(stkWallet.amount),
    Number(stkWallet.decimals),
    stkWallet.priceIn
  )

  const positions: Position[] = [
    {
      id: 'stk-wallet',
      additionalData: {
        name: 'Staked',
        positionInUSD
      },
      assets: [
        {
          address: '0x88800092fF476844f74dC2FC427974BBee2794Ae', // WALLET token addr
          symbol: 'WALLET',
          name: 'Ambire Wallet',
          iconUrl: '',
          decimals: 18,
          amount: stkWallet.amount,
          priceIn: stkWallet.priceIn[0],
          value: positionInUSD,
          type: AssetType.Collateral,
          additionalData: {},
          protocolAsset: {
            address: stkWallet.address,
            symbol: stkWallet.symbol,
            name: stkWallet.name,
            decimals: stkWallet.decimals
          }
        } as PositionAsset
      ]
    }
  ]

  return {
    providerName: 'Ambire',
    chainId: 1n,
    iconUrl: '',
    siteUrl: 'https://rewards.ambire.com',
    type: 'common',
    positionInUSD,
    positions
  }
}
