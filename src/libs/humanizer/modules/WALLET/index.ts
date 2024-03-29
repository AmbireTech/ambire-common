// update return ir to be {...ir,calls:newCalls} instead of {calls:newCalls} everywhere
import { WALLETSupplyControllerMapping } from './WALLETSupplyController'
import { StakingPools } from './stakingPools'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { AccountOp } from '../../../accountOp/accountOp'
import { checkIfUnknownAction, getUnknownVisualization } from '../../utils'

const stakingAddresses = [
  '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935',
  '0xb6456b57f03352be48bf101b46c1752a0813491a',
  '0xec3b10ce9cabab5dbf49f946a623e294963fbb4e'
]

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const WALLETModule: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const matcher = {
    supplyController: WALLETSupplyControllerMapping(accountOp.humanizerMeta),
    stakingPool: StakingPools(accountOp.humanizerMeta)
  }
  const newCalls = irCalls.map((call: IrCall) => {
    if (
      stakingAddresses.includes(call.to) &&
      (!call.fullVisualization || checkIfUnknownAction(call.fullVisualization))
    ) {
      if (matcher.stakingPool[call.data.slice(0, 10)]) {
        return {
          ...call,
          fullVisualization: matcher.stakingPool[call.data.slice(0, 10)](accountOp, call)
        }
      }
      return {
        ...call,
        fullVisualization: getUnknownVisualization('staking', call)
      }
    }
    if (matcher.supplyController[call.data.slice(0, 10)]) {
      return {
        ...call,
        fullVisualization: matcher.supplyController[call.data.slice(0, 10)](accountOp, call)
      }
    }
    return call
  })
  return [newCalls, []]
}
