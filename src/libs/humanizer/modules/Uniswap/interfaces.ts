import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerVisualizationItem } from '../../interfaces'
import { HexIrCall } from '../../utils'

export type HumanizerUniMatcher = {
  [key: string]: (a: AccountOp, c: HexIrCall) => HumanizerVisualizationItem[]
}
