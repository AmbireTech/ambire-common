import { getKnownName, getUnknownVisualization } from '../../utils'
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
    ...aaveLendingPoolV2(accountOp.humanizerMeta!),
    ...aaveWethGatewayV2(accountOp.humanizerMeta!)
  }
  const newCalls = irCalls.map((call) => {
    const sigHash = call.data.slice(0, 10)
    if (getKnownName(accountOp.humanizerMeta, call.to) === 'Aave') {
      return matcher[sigHash]
        ? { ...call, fullVisualization: matcher[sigHash](accountOp, call) }
        : {
            ...call,
            fullVisualization: getUnknownVisualization('Aave', call)
          }
    }
    return call
  })
  return [newCalls, []]
}
