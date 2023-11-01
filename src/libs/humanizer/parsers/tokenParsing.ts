/* eslint-disable no-nested-ternary */
import { ethers } from 'ethers'
import { networks } from '../../../consts/networks'
import {
  HumanizerFragment,
  HumanizerParsingModule,
  HumanizerSettings,
  HumanizerVisualization
} from '../interfaces'
import { getLabel, getTokenInfo } from '../utils'
import { MAX_UINT256 } from '../../../consts/deploy'

export const tokenParsing: HumanizerParsingModule = (
  humanizerSettings: HumanizerSettings,
  visualization: HumanizerVisualization[],
  options?: any
) => {
  const nativeSymbol = networks.find((n) => n.id === humanizerSettings.networkId)?.nativeAssetSymbol
  const asyncOps: Promise<HumanizerFragment | null>[] = []
  const fullVisualization: HumanizerVisualization[] = visualization.map(
    (v: HumanizerVisualization) => {
      if (v.type === 'token') {
        const tokenMeta =
          v.address === ethers.ZeroAddress
            ? nativeSymbol && [nativeSymbol, 18]
            : humanizerSettings.humanizerMeta?.[`tokens:${v.address}`]
        if (tokenMeta) {
          return v.amount === MAX_UINT256
            ? getLabel(`all ${tokenMeta[0]}`)
            : {
                ...v,
                symbol: v.symbol || tokenMeta[0],
                decimals: tokenMeta[1],
                readableAmount:
                  // only F's
                  v.amount === MAX_UINT256
                    ? 'all'
                    : v.amount
                    ? ethers.formatUnits(v.amount as bigint, tokenMeta[1])
                    : '0'
              }
        }
        asyncOps.push(getTokenInfo(humanizerSettings, v.address as string, options))
      }
      return v
    }
  )

  return [fullVisualization, [], asyncOps]
}
