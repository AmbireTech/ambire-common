/* eslint-disable no-await-in-loop */
import { toUtf8String, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  checkIfUnknownAction,
  getAction,
  getAddressVisualization,
  getLabel,
  getText,
  getToken
} from '../../utils'

export const asciiModule: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[]
) => {
  const newCalls = currentIrCalls.map((call) => {
    if (call.data === '0x') return call
    if (call.fullVisualization && !checkIfUnknownAction(call?.fullVisualization)) return call
    let messageAsText
    try {
      messageAsText = toUtf8String(call.data)
    } catch {
      return call
    }
    const sendNativeHumanization = call.value
      ? [getLabel('and'), getAction('Send'), getToken(ZeroAddress, call.value)]
      : []
    return {
      ...call,
      fullVisualization: [
        getAction('Send this message'),
        getLabel('to'),
        getAddressVisualization(call.to),
        getText(messageAsText),
        ...sendNativeHumanization
      ]
    }
  })
  return newCalls
}