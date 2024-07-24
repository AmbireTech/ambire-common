import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerVisualization, IrCall } from '../../interfaces'

export type HumanizerUniMatcher = {
  [key: string]: (a: AccountOp, c: IrCall) => HumanizerVisualization[]
}
