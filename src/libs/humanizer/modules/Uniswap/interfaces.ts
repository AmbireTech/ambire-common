import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'

export type HumanizerUniMatcher = { [key: string]: (a: AccountOp, c: IrCall) => IrCall[] }
