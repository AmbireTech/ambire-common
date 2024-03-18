import { ZeroAddress } from 'ethers'

import { networks } from '../../../consts/networks'
import {
  HumanizerFragment,
  HumanizerSettings,
  HumanizerVisualization,
  HumanizerWarning
} from '../interfaces'
import { getTokenInfo } from '../utils'

export const humanizerMetaParsing: HumanizerParsingModule = (
  humanizerSettings: HumanizerSettings,
  visualization: HumanizerVisualization[],
  options?: any
) => {
  const humanizerWarnings: HumanizerWarning[] = []
  const asyncOps: Promise<HumanizerFragment | null>[] = []
  const res: HumanizerVisualization[] = visualization.map((v) => {
    if (v.address) {
      if (v.address === ZeroAddress) {
        if (v.type === 'token') {
          const symbol = networks.find(
            ({ id }) => id === humanizerSettings.networkId
          )?.nativeAssetSymbol
          return symbol ? { ...v, humanizerMeta: { token: { symbol, decimals: 18 } } } : v
        }
        if (v.type === 'address') return v
      }
      const humanizerMeta =
        humanizerSettings?.humanizerMeta?.knownAddresses[v.address.toLowerCase()]
      if (humanizerMeta) {
        return {
          ...v,
          humanizerMeta
        }
      }

      if (v.type === 'token' && !v.humanizerMeta && !v.isHidden) {
        asyncOps.push(getTokenInfo(humanizerSettings, v.address, options))
        humanizerWarnings.push({
          content: `Unknown token ${v.address}`,
          level: 'caution'
        })
        return {
          ...v,
          warning: true
        }
      }
    }
    return v
  })

  return [res, humanizerWarnings, asyncOps]
}

export interface HumanizerParsingModule {
  (humanizerSettings: HumanizerSettings, visualization: HumanizerVisualization[], options?: any): [
    HumanizerVisualization[],
    HumanizerWarning[],
    Promise<HumanizerFragment | null>[]
  ]
}
