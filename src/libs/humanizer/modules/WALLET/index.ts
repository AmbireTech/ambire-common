// update return ir to be {...ir,calls:newCalls} instead of {calls:newCalls} everywhere
import { WALLETSupplyControllerMapping } from './WALLETSupplyController'
import { StakingPools } from './stakingPools'
import { Ir, IrCall } from '../../interfaces'
import { AccountOp } from '../../../accountOp/accountOp'
import { checkIfUnknowAction, getAction } from '../../utils'

const stakingAddresses = [
  '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935',
  '0xB6456b57f03352bE48Bf101B46c1752a0813491a',
  '0xEc3b10ce9cabAb5dbF49f946A623E294963fBB4E'
]

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const WALLETModule = (accountOp: AccountOp, ir: Ir, options?: any): [Ir, Promise<any>[]] => {
  const newCalls: IrCall[] = []
  const matcher = {
    ...WALLETSupplyControllerMapping(accountOp.humanizerMeta),
    // @TODO add addresses
    ...StakingPools(accountOp.humanizerMeta)
  }
  ir.calls.forEach((call: IrCall) => {
    // @TODO add check for address for supply controller?
    if (
      stakingAddresses.includes(call.to) &&
      (!call.fullVisualization || checkIfUnknowAction(call.fullVisualization))
    ) {
      if (matcher[call.data.slice(0, 10)]) {
        newCalls.push({
          ...call,
          fullVisualization: matcher[call.data.slice(0, 10)](accountOp, call)
        })
      } else {
        newCalls.push({ ...call, fullVisualization: [getAction('Unknown action (staking)')] })
      }
    } else {
      newCalls.push(call)
    }
  })
  return [{ ...ir, calls: newCalls }, []]
}
