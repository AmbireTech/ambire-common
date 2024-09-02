/* eslint-disable no-await-in-loop */
import { toUtf8String } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { checkIfUnknownAction, getText } from '../../utils'

export const asciiModule: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
) => {
  const newCalls = currentIrCalls.map((call) => {
    if (call.fullVisualization && !checkIfUnknownAction(call?.fullVisualization)) return call
    if(call.value) return call
    try {
      return {
        ...call,
        fullVisualization: [getText(toUtf8String(call.data))]
      }
    } catch (_) {
      return call
    }
  })
  console.log(newCalls.map(i=>i.fullVisualization))
  return newCalls
}
