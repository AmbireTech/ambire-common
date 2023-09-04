import { getAction, getAddress, getLabel } from '../../utils'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { aaveLendingPoolV2 } from './aaveLendingPoolV2'
import { aaveWethGatewayV2 } from './aaveWethGatewayV2'

export const aaveHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const matcher = {
    ...aaveLendingPoolV2(accountOp.humanizerMeta),
    ...aaveWethGatewayV2(accountOp.humanizerMeta)
  }
  const newCalls = irCalls.map((call) => {
    if (accountOp.humanizerMeta?.[`names:${call.to}`] === 'Aave') {
      return matcher[call.data.slice(0, 10)]
        ? { ...call, fullVisualization: matcher[call.data.slice(0, 10)](accountOp, call) }
        : {
            ...call,
            fullVisualization: [
              getAction('Unknwon action (Aave)'),
              getLabel('to'),
              getAddress(call.to)
            ]
          }
    }
    return call
  })
  return [newCalls, []]
}
