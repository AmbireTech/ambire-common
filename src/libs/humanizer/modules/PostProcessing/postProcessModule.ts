import { ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'

export const postProcessing: HumanizerCallModule = (_: AccountOp, call: IrCall) => {
  if (!call.fullVisualization) return call

  const intent = call.fullVisualization.intent.map((i) => {
    if (i.type === 'token' && i.address.toLowerCase() === '0x'.padEnd(42, 'e'))
      return { ...i, address: ZeroAddress }
    return i
  })
  return {
    ...call,
    fullVisualization: { ...call.fullVisualization, intent }
  }
}
