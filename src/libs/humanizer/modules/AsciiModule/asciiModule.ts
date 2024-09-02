/* eslint-disable no-await-in-loop */
import { toUtf8String } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  checkIfUnknownAction,
  getAction,
  getAddressVisualization,
  getLabel,
  getText
} from '../../utils'

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
        fullVisualization: [getAction('Send this message'), getLabel('to'), getAddressVisualization(call.to), getText(toUtf8String(call.data))]
      }
    } catch (_) {
      return call
    }
  })
  return newCalls
}
