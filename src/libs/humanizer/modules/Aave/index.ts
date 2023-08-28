import { getAction, getAddress, getLable } from '../../utils'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerFragment, Ir } from '../../interfaces'
import { aaveLendingPoolV2 } from './aaveLendingPoolV2'
import { aaveWethGatewayV2 } from './aaveWethGatewayV2'

export const aaveHumanizer = (
  accountOp: AccountOp,
  ir: Ir,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
): [Ir, Array<Promise<HumanizerFragment | null>>] => {
  const matcher = {
    ...aaveLendingPoolV2(accountOp.humanizerMeta),
    ...aaveWethGatewayV2(accountOp.humanizerMeta)
  }
  const newCalls = ir.calls.map((call) => {
    if (accountOp.humanizerMeta?.[`names:${call.to}`] === 'Aave') {
      return matcher[call.data.slice(0, 10)]
        ? { ...call, fullVisualization: matcher[call.data.slice(0, 10)](accountOp, call) }
        : {
            ...call,
            fullVisualization: [
              getAction('Unknwon action (Aave)'),
              getLable('to'),
              getAddress(call.to)
            ]
          }
    }
    return call
  })
  const newIr = { calls: newCalls }
  return [newIr, []]
}
