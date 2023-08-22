// update return ir to be {...ir,calls:newCalls} instead of {calls:newCalls} everywhere
import { WALLETSupplyControllerMapping } from './WALLETSupplyController'
import { WALLETStakingPool } from './WALLETStakingPool'
import { Ir, IrCall } from '../../interfaces'
import { AccountOp } from '../../../accountOp/accountOp'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const WALLETModule = (accountOp: AccountOp, ir: Ir, options?: any) => {
  const newCalls: IrCall[] = []
  const matcher = {
    ...WALLETSupplyControllerMapping(accountOp.humanizerMeta),
    ...WALLETStakingPool(accountOp.humanizerMeta)
  }
  ir.calls.forEach((call: IrCall) => {
    // @TODO add check for address for supply controller?
    if (
      matcher[call.data.slice(0, 10)] ||
      call.to === '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935'
    ) {
      newCalls.push({
        ...call,
        fullVisualization: matcher[call.data.slice(0, 10)](accountOp, call)
      })
    } else {
      newCalls.push(call)
    }
  })
  return [{ ...ir, call: newCalls }, []]
}
