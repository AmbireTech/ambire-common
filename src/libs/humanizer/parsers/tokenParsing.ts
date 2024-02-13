/* eslint-disable no-nested-ternary */
import { ethers } from 'ethers'

import { MAX_UINT256 } from '../../../consts/deploy'
import { networks } from '../../../consts/networks'
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
  const nativeSymbol = networks.find((n) => n.id === humanizerSettings.networkId)?.nativeAssetSymbol
  const asyncOps: Promise<HumanizerFragment | null>[] = []
  const fullVisualization: HumanizerVisualization[] = visualization.map(
    (v: HumanizerVisualization) => {
      if (v.type === 'token') {
        const tokenMeta =
          v.address === ethers.ZeroAddress
            ? nativeSymbol && { symbol: nativeSymbol, decimals: 18, networks: [] }
            : humanizerSettings.humanizerMeta?.knownAddresses?.[v.address!.toLowerCase()]?.token
        if (tokenMeta) {
          return v.amount === MAX_UINT256
            ? getLabel(`all ${tokenMeta.symbol}`)
            : {
                ...v,
                symbol: v.symbol || tokenMeta.symbol,
                decimals: tokenMeta.decimals,
                readableAmount:
                  // only F's
                  v.amount === MAX_UINT256
                    ? 'all'
                    : v.amount
                    ? ethers.formatUnits(v.amount as bigint, tokenMeta.decimals)
                    : '0'
              }
        }
        // @TODO this shouldn't be here, fetching tokens data should be in tokens module
        // parsing modules should be as clean as possiblr
        asyncOps.push(getTokenInfo(humanizerSettings, v.address as string, options))
      }
      return v
    }
  )

  return [fullVisualization, [], asyncOps]
}
