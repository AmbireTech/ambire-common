import { ZeroAddress } from 'ethers'

import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../interfaces'
import { getAction, getKnownName, getToken } from '../utils'

// @TODO add test
export const gasTankModule: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const newCalls = irCalls.map((call) => {
    if (getKnownName(accountOp.humanizerMeta, call.to) === 'Gas Tank')
      return {
        ...call,
        fullVisualization: [getAction('Fuel gas tank with'), getToken(ZeroAddress, call.value)]
      }
    if (
      call.fullVisualization?.[0]?.content === 'Send' &&
      call.fullVisualization?.[1]?.type === 'token' &&
      call.fullVisualization?.[2]?.content === 'to' &&
      call.fullVisualization?.[3].type === 'address' &&
      getKnownName(accountOp.humanizerMeta, call.fullVisualization[3].address!) === 'Gas Tank'
    )
      return {
        ...call,
        fullVisualization: [getAction('Fuel gas tank with'), call.fullVisualization[1]]
      }
    return call
  })
  return [newCalls, []]
}
