import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { Pancake } from '../../const/abis/pancake'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../../utils'

const PancakeModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const iface = new Interface(Pancake)
  const matcher = {
    [iface.getFunction('approve(address token, address spender, uint160 amount, uint48 expiration)')
      ?.selector!]: (call: IrCall) => {
      const { token, spender, amount, expiration } = iface.parseTransaction(call)!.args
      return [
        getAction('Approve'),
        getAddressVisualization(spender),
        getLabel('to use'),
        getToken(token, amount),
        getDeadline(expiration)
      ]
    }
  }
  const newCalls = calls.map((call) => {
    if (call.fullVisualization || !matcher[call.data.slice(0, 10)]) return call
    return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) }
  })

  return newCalls
}

export default PancakeModule
