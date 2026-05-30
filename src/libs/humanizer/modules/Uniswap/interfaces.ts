import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerVisualization } from '../../interfaces'
import { HexIrCall } from '../../utils'

export type HumanizerUniMatcher = {
  [key: string]: (a: AccountOp, c: HexIrCall) => HumanizerVisualization[]
}
