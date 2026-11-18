import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerVisualization } from '../../interfaces'
import { HexIrCall } from '../../utils'
import { UniswapSummary } from './render'

/** The functions that are described as text, one function at a time (adding and removing liquidity) */
export type HumanizerUniMatcher = {
  [key: string]: (a: AccountOp, c: HexIrCall) => HumanizerVisualization[]
}

/** The functions that are described from what they do with the tokens (swaps, payments, multicalls) */
export type UniswapSummaryMatcher = {
  [key: string]: (a: AccountOp, c: HexIrCall) => UniswapSummary
}
