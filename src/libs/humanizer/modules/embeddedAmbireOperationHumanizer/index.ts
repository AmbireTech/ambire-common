import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getWarning } from '../../utils'

export const EMBEDDED_OPERATION_WARNING_CODE = 'AMBIRE_EMBEDDED_OPERATION'

// the purpose of this module is simply to visualize attempts to hide ambire operations within the current account op
// such thing can be done if the dapp requests a tryCatch/executeBySelfSingle/executeBySelf/... function call directed to the current account
// this call will be executed without needing extra authentication. For more details check out AmbireAccount.sol
export const embeddedAmbireOperationHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  call: IrCall
) => {
  if (!call.to) return call
  if (call.fullVisualization) return call
  if (call.data === '0x') return call
  if (call.to.toLowerCase() === accountOp.accountAddr.toLowerCase()) {
    return {
      ...call,
      fullVisualization: [getAction('Allow multiple actions from this account')],
      warnings: [
        ...(call.warnings || []),
        getWarning(
          'This lets the app perform several actions using your account, one after another, without asking you to confirm each one separately. Only proceed if you trust it',
          EMBEDDED_OPERATION_WARNING_CODE
        )
      ]
    }
  }
  return call
}
