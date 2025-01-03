import { Interface, Result } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { AmbireAccount } from '../../const/abis/AmbireAccount'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel } from '../../utils'

// the purpose of this module is simply to visualize attempts to hide ambire operations within the current account op
// such thing can be done if the dapp requests a tryCatch/executeBySelfSingle/executeBySelf function call directed to the current account
// this call will be executed without needing extra authentication. For more details check out AmbireAccount.sol
export const embeddedAmbireOperationHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[]
) => {
  const iface = new Interface(AmbireAccount)
  const matcher: { [selector: string]: (originalCall: IrCall) => IrCall[] } = {
    [iface.getFunction('tryCatch')!.selector]: (originalCall: IrCall) => {
      const { to, value, data } = iface.decodeFunctionData('tryCatch', originalCall.data)
      return [{ ...originalCall, to, value, data }]
    },
    [iface.getFunction('tryCatchLimit')!.selector]: (originalCall: IrCall) => {
      const { to, value, data } = iface.decodeFunctionData('tryCatchLimit', originalCall.data)
      return [{ ...originalCall, to, value, data }]
    },
    [iface.getFunction('executeBySelfSingle')!.selector]: (originalCall: IrCall) => {
      const {
        call: { to, value, data }
      } = iface.decodeFunctionData('executeBySelfSingle', originalCall.data)
      return [{ ...originalCall, to, value, data }]
    },
    [iface.getFunction('executeBySelf')!.selector]: (originalCall: IrCall) => {
      const { calls } = iface.decodeFunctionData('executeBySelf', originalCall.data)
      // ethers returns Result type, which we do not want to leak in the result
      return calls.map(({ to, value, data }: Result) => ({ ...originalCall, to, value, data }))
    }
  }
  const functionSelectorsCallableFromSigner = ['execute', 'executeMultiple', 'executeBySender'].map(
    (i) => iface.getFunction(i)!.selector
  )
  const newCalls: IrCall[] = []

  irCalls.forEach((call) => {
    if (call.to === accountOp.accountAddr && matcher[call.data.slice(0, 10)]) {
      newCalls.push(...matcher[call.data.slice(0, 10)](call))
      return
    }
    if (functionSelectorsCallableFromSigner.includes(call.data.slice(0, 10))) {
      newCalls.push({
        ...call,
        fullVisualization: [
          getAction('Execute calls'),
          getLabel('from'),
          getAddressVisualization(call.to)
        ]
      })
      return
    }
    newCalls.push(call)
  })
  return newCalls
}
