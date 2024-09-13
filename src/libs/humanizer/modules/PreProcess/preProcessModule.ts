import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'

export const preProcessHumanizer: HumanizerCallModule = (
  _: AccountOp,
  currentIrCalls: IrCall[]
) => {
  const newCalls = currentIrCalls.map((_call) => {
    const call = { ..._call }
    if (!call.data) {
      call.data = '0x'
    }
    return call
  })
  return newCalls
}
