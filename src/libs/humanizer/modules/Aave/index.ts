import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { aaveLendingPoolV2 } from './aaveLendingPoolV2'
import { aaveWethGatewayV2 } from './aaveWethGatewayV2'

export const aaveHumanizer: HumanizerCallModule = (accountOp: AccountOp, irCalls: IrCall[]) => {
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
