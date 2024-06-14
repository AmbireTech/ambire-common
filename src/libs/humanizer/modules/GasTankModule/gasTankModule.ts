import { ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, IrCall } from '../../interfaces'
import { getAction, getKnownName, getToken } from '../../utils'

export const gasTankModule: HumanizerCallModule = (
  _: AccountOp,
  irCalls: IrCall[],
  humanizerMeta: HumanizerMeta
) => {
  const newCalls = irCalls.map((call) => {
    if (getKnownName(humanizerMeta, call.to) === 'Gas Tank')
      return {
        ...call,
        fullVisualization: [getAction('Fuel gas tank with'), getToken(ZeroAddress, call.value)]
      }
    if (
      call.fullVisualization?.[0]?.content === 'Send' &&
      call.fullVisualization?.[1]?.type === 'token' &&
      call.fullVisualization?.[2]?.content === 'to' &&
      call.fullVisualization?.[3].type === 'address' &&
      getKnownName(humanizerMeta, call.fullVisualization[3].address!) === 'Gas Tank'
    )
      return {
        ...call,
        fullVisualization: [getAction('Fuel gas tank with'), call.fullVisualization[1]]
      }
    return call
  })
  return [newCalls, []]
}
