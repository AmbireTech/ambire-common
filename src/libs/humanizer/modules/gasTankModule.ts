import { ethers } from 'ethers'
import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../../interfaces/humanizer'
import { getAction, getToken } from '../utils'

// @TODO add test
export const gasTankModule: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const newCalls = irCalls.map((call) => {
    return accountOp.humanizerMeta?.[`names:${call.to}`] === 'Gas Tank'
      ? {
          ...call,
          fullVisualization: [
            getAction('Fuel gas tank with'),
            getToken(ethers.ZeroAddress, call.value)
          ]
        }
      : call
  })
  return [newCalls, []]
}
