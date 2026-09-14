import { ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'

export const postProcessing: HumanizerCallModule = (_: AccountOp, call: IrCall) => {
  const fullVisualization = call.fullVisualization?.map((i) => {
    if (i.type === 'token' && i.address.toLowerCase() === '0x'.padEnd(42, 'e'))
      return { ...i, address: ZeroAddress }
    return i
  })
  return {
    ...call,
    fullVisualization
  }
}
