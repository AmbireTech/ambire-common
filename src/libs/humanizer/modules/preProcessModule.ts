import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../interfaces'


export const preProcessHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  _,
) => {

  const newCalls = currentIrCalls.map((_call) => {
    let call = {..._call}
    if(call.data === null){
        call.data = '0x'
    }
    return call
  })
  return [newCalls,[]]
}
