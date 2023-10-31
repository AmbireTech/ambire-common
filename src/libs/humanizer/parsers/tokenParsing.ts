/* eslint-disable no-nested-ternary */
import { ethers } from 'ethers'

import { nativeTokens } from '../../../consts/networks'
import {
  HumanizerFragment,
  HumanizerParsingModule,
  HumanizerSettings,
  HumanizerVisualization
} from '../interfaces'
import { getLabel, getTokenInfo } from '../utils'

export const tokenParsing: HumanizerParsingModule = (
  humanizerSettings: HumanizerSettings,
  visualization: HumanizerVisualization[],
  options?: any
) => {
  const asyncOps: Promise<HumanizerFragment | null>[] = []
  const fullVisualization: HumanizerVisualization[] = visualization.map(
    (v: HumanizerVisualization) => {
      if (v.type === 'token') {
        const tokenMeta =
          v.address === ethers.ZeroAddress
            ? nativeTokens[humanizerSettings.networkId]
            : humanizerSettings.humanizerMeta?.[`tokens:${v.address}`]
        if (tokenMeta) {
          return v.amount ===
            115792089237316195423570985008687907853269984665640564039457584007913129639935n
            ? getLabel(`all ${tokenMeta[0]}`)
            : {
                ...v,
                symbol: v.symbol || tokenMeta[0],
                decimals: tokenMeta[1],
                readableAmount:
                  // only F's
                  v.amount ===
                  115792089237316195423570985008687907853269984665640564039457584007913129639935n
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
