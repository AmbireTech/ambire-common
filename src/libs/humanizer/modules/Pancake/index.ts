import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { Pancake } from '../../const/abis/Pancake'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../../utils'

const iface = new Interface(Pancake)

const PancakeModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const matcher = {
    [iface.getFunction('approve(address token, address spender, uint160 amount, uint48 expiration)')
      ?.selector!]: (call: IrCall) => {
      const { token, spender, amount, expiration } = iface.parseTransaction(call)!.args
      const expirationHumanization = expiration > 0 ? getDeadline(expiration) : getLabel('now')

      if (amount > 0)
        return [
          getAction('Approve'),
          getAddressVisualization(spender),
          getLabel('to use'),
          getToken(token, amount),
          expirationHumanization
        ]
      return [
        getAction('Revoke approval'),
        getToken(token, amount),
        getLabel('for'),
        getAddressVisualization(spender)
      ]
    }
  }
  const newCalls = calls.map((call) => {
    const selector = call.data.slice(0, 10)
    if (call.fullVisualization || !matcher[selector]) return call
    return { ...call, fullVisualization: matcher[selector](call) }
  })

  return newCalls
}

export default PancakeModule
