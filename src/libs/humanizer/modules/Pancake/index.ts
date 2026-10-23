import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerWarning,
  IrCall,
  RichHumanizerVisualization
} from '../../interfaces'
import {
  HexIrCall,
  formatTimestampAsDate,
  getAddressVisualization,
  getRichVisualization,
  getSingleValueRow,
  getText,
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
//
// It is shown the way an ERC-7730 descriptor shows it: an intent and labelled rows.
const approveAbi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)'
])

const approveSelector = toFunctionSelector(approveAbi[0])

const PancakeModule: HumanizerCallModule = (accOp: AccountOp, call: IrCall) => {
  const matcher: Record<
    string,
    (call: HexIrCall) => {
      visualization: RichHumanizerVisualization
      warning?: HumanizerWarning
    }
  > = {
    [approveSelector]: (call) => {
      const { args } = decodeFunctionData({ abi: approveAbi, data: padCallData(call.data, 4) })
      const [token, spender, amount, expiration] = args
      // An expiration of zero makes the allowance expire as soon as it is set
      const expirationText =
        expiration > 0
          ? (formatTimestampAsDate(BigInt(expiration)) ?? expiration.toString())
          : 'now'

      return {
        visualization: getRichVisualization(amount === 0n ? 'Revoke approval' : 'Approve', [
          getSingleValueRow('Spender', getAddressVisualization(spender)),
          getSingleValueRow('Amount', getToken(token, amount, accOp.chainId)),
          getSingleValueRow('Approval expires', getText(expirationText))
        ]),
        warning: isUnlimitedAmount(amount, 160) ? getUnlimitedApprovalWarning(spender) : undefined
      }
    }
  }
  const selector = call.data.slice(0, 10)
  if (call.fullVisualization || !isHexCall(call) || !matcher[selector]) return call

  const { visualization, warning } = matcher[selector](call)
  return {
    ...call,
    fullVisualization: visualization,
    warnings: mergeWarnings(call.warnings, warning ? [warning] : [])
  }
}

export default PancakeModule
