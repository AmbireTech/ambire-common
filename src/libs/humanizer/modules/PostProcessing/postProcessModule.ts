import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getToken } from '../../utils'

export const postProcessing: HumanizerCallModule = (_: AccountOp, currentIrCalls: IrCall[]) => {
  const newCalls = currentIrCalls.map((_call) => ({
    ..._call,
    fullVisualization: [...(_call?.fullVisualization || []), getToken(_call.to, 0n, true)]
  }))
  return [newCalls, []]
}
