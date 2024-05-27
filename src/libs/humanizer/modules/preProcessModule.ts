import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, HumanizerPromise, IrCall } from '../interfaces'


export const preProcessHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  humanizerMeta: HumanizerMeta,
  options?: any
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
