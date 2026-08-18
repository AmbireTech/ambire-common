import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  HexIrCall,
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getToken,
  isHexCall
} from '../../utils'

const approveAbi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)'
])

const PancakeModule: HumanizerCallModule = (accOp: AccountOp, call: IrCall) => {
  const matcher: Record<string, (call: HexIrCall) => any> = {
    [toFunctionSelector(approveAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: approveAbi, data: call.data })
      const [token, spender, amount, expiration] = args
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
  const selector = call.data.slice(0, 10)
  if (call.fullVisualization || !isHexCall(call) || !matcher[selector]) return call
  return { ...call, fullVisualization: matcher[selector](call) }
}

export default PancakeModule
