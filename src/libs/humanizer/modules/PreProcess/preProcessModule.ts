import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'

export const preProcessHumanizer: HumanizerCallModule = (_: AccountOp, _call: IrCall) => {
  const call = { ..._call }
  if (!call.data) {
    call.data = '0x'
  }
  return call
}
