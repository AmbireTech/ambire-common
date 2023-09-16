import { ethers } from 'ethers'
import { nativeTokens } from '../../../consts/networks'
import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerFragment, HumanizerParsingModule, HumanizerVisualization } from '../interfaces'
import { getLabel, getTokenInfo } from '../utils'

export const tokenParsing: HumanizerParsingModule = (
  accounOp: AccountOp,
  visualization: HumanizerVisualization[],
  options?: any
) => {
  const asyncOps: Promise<HumanizerFragment | null>[] = []
  const fullVisualization: HumanizerVisualization[] = visualization.map(
    (v: HumanizerVisualization) => {
      if (v.type === 'token') {
        const tokenMeta =
          v.address === ethers.ZeroAddress
            ? nativeTokens[accounOp.networkId]
            : accounOp.humanizerMeta?.[`tokens:${v.address}`]
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
                    : ethers.formatUnits(v.amount as bigint, tokenMeta[1])
              }
        }
        asyncOps.push(getTokenInfo(accounOp, v.address as string, options))
      }
      return v
    }
  )

  return [fullVisualization, [], asyncOps]
}
