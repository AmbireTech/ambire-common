import { ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getToken } from '../../utils'

export const postProcessing: HumanizerCallModule = (_: AccountOp, currentIrCalls: IrCall[]) => {
  const newCalls = currentIrCalls.map((_call) => {
    const fullVisualization = (_call?.fullVisualization || []).map((i) => {
      if (i.type === 'token' && i.address.toLowerCase() === '0x'.padEnd(42, 'e'))
        return { ...i, address: ZeroAddress }
      return i
    })
    if (_call.to) fullVisualization.push(getToken(_call.to, 0n, true))
    return {
      ..._call,
      fullVisualization
    }
  })
  return newCalls
}
