import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerFragment, Ir } from '../../interfaces'
import { aaveLendingPoolV2 } from './aaveLendingPoolV2'
import { aaveWethGatewayV2 } from './aaveWethGatewayV2'

export const aaveHumanizer = (
  accountOp: AccountOp,
  ir: Ir
): [Ir, Array<Promise<HumanizerFragment>>] => {
  const matcher = {
    ...aaveLendingPoolV2(accountOp.humanizerMeta),
    ...aaveWethGatewayV2(accountOp.humanizerMeta)
  }
  const newCalls = ir.calls.map((call) => {
    if (accountOp.humanizerMeta?.[`names:${call.to}`] === 'Aave') {
      return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](accountOp, call) }
    }
    return call
  })
  const newIr = { calls: newCalls }
  return [newIr, []]
}
