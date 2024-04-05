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
        const symbol = networks.find(
          ({ id }) => id === humanizerSettings.networkId
        )?.nativeAssetSymbol
        return symbol
          ? {
              ...v,
              humanizerMeta: { name: 'Blackhole', token: { symbol, decimals: 18 } }
            }
          : v
      }

      const humanizerMeta =
        humanizerSettings?.humanizerMeta?.knownAddresses[v.address.toLowerCase()]
      if (v.type === 'token' && !humanizerMeta?.token && !v.isHidden) {
        asyncOps.push(getTokenInfo(humanizerSettings, v.address, options))
        return {
          ...v,
          humanizerMeta
        }
      }
      return {
        ...v,
        humanizerMeta
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
