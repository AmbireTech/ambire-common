import { ethers } from 'ethers'
import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../interfaces'
import { getAction, getToken } from '../utils'

// @TODO add test
export const gasTankModule: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const newCalls = irCalls.map((call) => {
    if (accountOp.humanizerMeta?.knownAddresses[call.to.toLowerCase()]?.name === 'Gas Tank')
      return {
        ...call,
        fullVisualization: [
          getAction('Fuel gas tank with'),
          getToken(ethers.ZeroAddress, call.value)
        ]
      }
    if (
      call.fullVisualization?.[0]?.content === 'Send' &&
      call.fullVisualization?.[1]?.type === 'token' &&
      call.fullVisualization?.[2]?.content === 'to' &&
      call.fullVisualization?.[3].type === 'address' &&
      accountOp.humanizerMeta?.knownAddresses[call.fullVisualization[3].address!.toLowerCase()]
        .name === 'Gas Tank'
    )
      return {
        ...call,
        fullVisualization: [getAction('Fuel gas tank with'), call.fullVisualization[1]]
      }
    return call
  })
  return [newCalls, []]
}
