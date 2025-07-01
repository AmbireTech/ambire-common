/* eslint-disable no-await-in-loop */
import { getBytes, toUtf8String, ZeroAddress } from 'ethers'

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

function tryGetMEssageAsText(msg: string) {
  const bytes = getBytes(msg)
  const expectedPortionOfValidChars = 0.9
  const numberOfValidCharacters = bytes.filter((x) => x >= 0x20 && x <= 0x7e).length

  if (bytes.length * expectedPortionOfValidChars < numberOfValidCharacters) {
    try {
      return toUtf8String(msg)
    } catch (_) {
      return null
    }
  }
  return null
}
export const asciiModule: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[]
) => {
  const newCalls = currentIrCalls.map((call) => {
    if (!call.data || call.data === '0x') return call
    if (call.fullVisualization && !checkIfUnknownAction(call?.fullVisualization)) return call
    // assuming that if there are only 4 bytes it is probably just contract method call
    // and further logic is irrelevant
    if (call.data.length === '0x12345678'.length) return call

    let messageAsText = tryGetMEssageAsText(call.data)
    if (!messageAsText) return call

    const sendNativeHumanization = call.value
      ? [getLabel('and'), getAction('Send'), getToken(ZeroAddress, call.value)]
      : []
    return {
      ...call,
      fullVisualization: call.to
        ? [
            getAction('Send this message'),
            getLabel('to'),
            getAddressVisualization(call.to),
            getText(messageAsText),
            ...sendNativeHumanization
          ]
        : [getAction('Send this message'), getText(messageAsText), ...sendNativeHumanization]
    }
  })
  return newCalls
}
