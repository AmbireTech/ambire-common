import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerVisualization,
  HumanizerWarning,
  IrCall
} from '../../interfaces'
import {
  HexIrCall,
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getToken,
  getUnlimitedApprovalWarning,
  isHexCall,
  isUnlimitedAmount,
  mergeWarnings,
  padCallData
} from '../../utils'

// This is the Permit2 `approve`, which Pancake's permit contract shares. Permit2 keeps the
// allowance itself instead of the token contract, so the token is an argument rather than the
// call target, and the amount is a uint160 - its "no limit" value is smaller than the uint256
// one an ERC-20 approval uses.
const approveAbi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)'
])

const PancakeModule: HumanizerCallModule = (accOp: AccountOp, call: IrCall) => {
  const matcher: Record<
    string,
    (call: HexIrCall) => { visualizations: HumanizerVisualization[]; warning?: HumanizerWarning }
  > = {
    [toFunctionSelector(approveAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: approveAbi, data: padCallData(call.data, 4) })
      const [token, spender, amount, expiration] = args
      const expirationHumanization = expiration > 0 ? getDeadline(expiration) : getLabel('now')

      if (amount === 0n)
        return {
          visualizations: [
            getAction('Revoke approval'),
            getToken(token, amount),
            getLabel('for'),
            getAddressVisualization(spender)
          ]
        }

      return {
        visualizations: [
          getAction('Approve'),
          getAddressVisualization(spender),
          getLabel('to use'),
          getToken(token, amount),
          expirationHumanization
        ],
        warning: isUnlimitedAmount(amount, 160) ? getUnlimitedApprovalWarning(spender) : undefined
      }
    }
  }
  const selector = call.data.slice(0, 10)
  if (call.fullVisualization || !isHexCall(call) || !matcher[selector]) return call

  const { visualizations, warning } = matcher[selector](call)

  return {
    ...call,
    fullVisualization: visualizations,
    warnings: mergeWarnings(call.warnings, warning ? [warning] : [])
  }
}

export default PancakeModule
