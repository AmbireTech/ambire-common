import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, IrCall } from '../../interfaces'
import { getKnownName, getUnknownVisualization } from '../../utils'
import { aaveLendingPoolV2 } from './aaveLendingPoolV2'
import { aaveWethGatewayV2 } from './aaveWethGatewayV2'

export const aaveHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  humanizerMeta: HumanizerMeta,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const matcher = {
    ...aaveLendingPoolV2(),
    ...aaveWethGatewayV2()
  }
  const newCalls = irCalls.map((call) => {
    const sigHash = call.data.slice(0, 10)
      return matcher[sigHash]
        ? { ...call, fullVisualization: matcher[sigHash](accountOp, call) }
        : call
  })
  return [newCalls, []]
}
