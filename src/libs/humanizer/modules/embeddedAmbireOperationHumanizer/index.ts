import { Interface, Result } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { AmbireAccount } from '../../const/abis/AmbireAccount'
import { HumanizerCallModule, IrCall } from '../../interfaces'

// the purpose of this module is simply to visualize attempts to hide ambire operations within the current account op
// such thing can be done if the dapp requests a tryCatch/executeBySelfSingle/executeBySelf function call directed to the current account
// this call will be executed without needing extra authentication. For more details check out AmbireAccount.sol
export const embeddedAmbireOperationHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[]
) => {
  const iface = new Interface(AmbireAccount)
  const matcher: { [selector: string]: (call: IrCall) => IrCall[] } = {
    [iface.getFunction('tryCatch')!.selector]: (call: IrCall) => {
      const { to, value, data } = iface.decodeFunctionData('tryCatch', call.data)
      return [{ to, value, data }]
    },
    [iface.getFunction('tryCatchLimit')!.selector]: (call: IrCall) => {
      const { to, value, data } = iface.decodeFunctionData('tryCatchLimit', call.data)
      return [{ to, value, data }]
    },
    [iface.getFunction('executeBySelfSingle')!.selector]: (call: IrCall) => {
      const {
        call: { to, value, data }
      } = iface.decodeFunctionData('executeBySelfSingle', call.data)
      return [{ to, value, data }]
    },
    [iface.getFunction('executeBySelf')!.selector]: (call: IrCall) => {
      const { calls } = iface.decodeFunctionData('executeBySelf', call.data)
      // ethers returns Result type, which we do not want to leak in the result
      return calls.map(({ to, value, data }: Result) => ({ to, value, data }))
    }
  }
  const newCalls: IrCall[] = []
  irCalls.forEach((call) => {
    if (call.to === accountOp.accountAddr && matcher[call.data.slice(0, 10)])
      newCalls.push(...matcher[call.data.slice(0, 10)](call))
    else newCalls.push(call)
  })
  return newCalls
}
