import { ZeroAddress } from 'ethers'

import { FEE_COLLECTOR } from '../../../../consts/addresses'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getToken } from '../../utils'

export const gasTankModule: HumanizerCallModule = (_: AccountOp, irCalls: IrCall[]) => {
  const newCalls = irCalls.map((call) => {
    // @TODO fix those upper/lowercase
    if (call.to.toLowerCase() === FEE_COLLECTOR.toLowerCase())
      return {
        ...call,
        fullVisualization: [getAction('Fuel gas tank with'), getToken(ZeroAddress, call.value)]
      }
    if (
      call.fullVisualization?.[0]?.content === 'Send' &&
      call.fullVisualization?.[1]?.type === 'token' &&
      call.fullVisualization?.[2]?.content === 'to' &&
      call.fullVisualization?.[3].type === 'address' &&
      call.fullVisualization[3].address!.toLowerCase() === FEE_COLLECTOR.toLowerCase()
    )
      return {
        ...call,
        fullVisualization: [getAction('Fuel gas tank with'), call.fullVisualization[1]]
      }
    return call
  })
  return [newCalls, []]
}
