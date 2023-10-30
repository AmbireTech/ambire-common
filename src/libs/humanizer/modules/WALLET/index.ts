// update return ir to be {...ir,calls:newCalls} instead of {calls:newCalls} everywhere
import { ethers } from 'ethers'
import { WALLETSupplyControllerMapping } from './WALLETSupplyController'
import { StakingPools } from './stakingPools'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { AccountOp } from '../../../accountOp/accountOp'
import { checkIfUnknowAction, getAction, getLabel, getToken } from '../../utils'

const stakingAddresses = [
  '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935',
  '0xB6456b57f03352bE48Bf101B46c1752a0813491a',
  '0xEc3b10ce9cabAb5dbF49f946A623E294963fBB4E'
]

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const WALLETModule: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const newCalls: IrCall[] = []
  const matcher = {
    supplyController: WALLETSupplyControllerMapping(accountOp.humanizerMeta),
    stakingPool: StakingPools(accountOp.humanizerMeta)
  }
  irCalls.forEach((call: IrCall) => {
    if (
      stakingAddresses.includes(call.to) &&
      (!call.fullVisualization || checkIfUnknowAction(call.fullVisualization))
    ) {
      if (matcher.stakingPool[call.data.slice(0, 10)]) {
        newCalls.push({
          ...call,
          fullVisualization: matcher.stakingPool[call.data.slice(0, 10)](accountOp, call)
        })
      } else {
        const unknownVisualization = [getAction('Unknown action (staking)')]
        if (call.value)
          unknownVisualization.push(
            ...[getLabel('and send'), getToken(ethers.ZeroAddress, call.value)]
          )
        newCalls.push({ ...call, fullVisualization: unknownVisualization })
      }
    } else if (matcher.supplyController[call.data.slice(0, 10)]) {
      newCalls.push({
        ...call,
        fullVisualization: matcher.supplyController[call.data.slice(0, 10)](accountOp, call)
      })
    } else {
      newCalls.push(call)
    }
  })
  return [newCalls, []]
}
