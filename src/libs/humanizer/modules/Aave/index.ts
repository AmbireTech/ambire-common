import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { isHexCall } from '../../utils'
import { aaveLendingPoolV2 } from './aaveLendingPoolV2'
import { aaveV3Pool } from './aaveV3'
import { aaveWethGatewayV2 } from './aaveWethGatewayV2'

const matcher = {
  ...aaveLendingPoolV2(),
  ...aaveWethGatewayV2(),
  ...aaveV3Pool()
}

export const aaveHumanizer: HumanizerCallModule = (accountOp: AccountOp, irCalls: IrCall[]) => {
  const newCalls = irCalls.map((call) => {
    if (!call.to || !isHexCall(call)) return call
    const sigHash = call.data.slice(0, 10)
    return matcher[sigHash]
      ? { ...call, fullVisualization: matcher[sigHash](accountOp, call) }
      : call
  })
  return newCalls
}
