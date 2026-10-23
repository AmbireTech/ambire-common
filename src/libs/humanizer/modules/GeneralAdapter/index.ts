import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { decodeGeneralAdapterCall } from '../Bundler3/generalAdapter'

/**
 * Describes a call to a Morpho general adapter. A Bundler3 bundle sends its actions to an adapter,
 * and the adapter carries the action in its own calldata (an ERC-20 transfer, a Morpho repay, a
 * vault deposit and so on), so the call is described by its function and not by the contract.
 * The warnings of the decoder are kept, for example when the receiver is not the account.
 *
 * It matches by function selector, because the adapters have no address list yet. So it runs after
 * every module that knows a contract, and it only describes a call that no other module described.
 */
export const generalAdapterModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  if (call.fullVisualization) return call

  const decodedCall = decodeGeneralAdapterCall(accountOp.accountAddr, call)
  if (decodedCall === call || !decodedCall.fullVisualization) return call

  return {
    ...decodedCall,
    fullVisualization: {
      ...decodedCall.fullVisualization,
      // The decoder starts every action with a line break, which the bundle view puts itself
      intent: decodedCall.fullVisualization.intent.filter((item) => item.type !== 'break')
    }
  }
}
