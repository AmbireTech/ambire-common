import { ZeroAddress } from 'ethers'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp, getAccountOpNonce } from '../../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getKnownFunctionName,
  getLabel,
  getToken
} from '../../utils'

export const fallbackHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  call: IrCall
): IrCall => {
  const dataKey = !call.data || call.data === '0x' ? 'no-data' : 'has-data'
  const valueKey = call.value ? 'has-value' : 'no-value'
  const toKey = call.to ? 'has-to' : 'no-to'

  switch (`${toKey}:${valueKey}:${dataKey}`) {
    case 'no-to:no-value:no-data':
    case 'no-to:no-value:has-data':
      return { ...call, fullVisualization: [getAction('Deploy'), getLabel('contract')] }
    case 'no-to:has-value:no-data':
    case 'no-to:has-value:has-data':
      return {
        ...call,
        fullVisualization: [
          getAction('Deploy'),
          getLabel('contract'),
          getLabel('and'),
          getAction('Burn', { warning: true }),
          getToken(ZeroAddress, call.value)
        ]
      }
    case 'has-to:no-value:no-data':
      const safeNonce = getAccountOpNonce(accountOp)
      if (accountOp.meta?.isOnchainSafeRejection && call.to === ZeroAddress && safeNonce !== null) {
        return {
          ...call,
          fullVisualization: [getAction(`Cancel transaction with nonce ${safeNonce.toString()}`)]
        }
      }
      // preserve a visualization already set by an earlier, more specific module (e.g. a
      // Safe{WALLET} "reject queued transaction" call), instead of unconditionally
      // overwriting it with a generic "Empty call to" label below
      if (call.fullVisualization) return call
      return {
        ...call,
        fullVisualization: [getAction('Empty call to'), getAddressVisualization(call.to!)]
      }
    case 'has-to:has-value:no-data':
      return {
        ...call,
        fullVisualization: [
          getAction('Send'),
          getToken(ZeroAddress, call.value),
          getLabel('to'),
          getAddressVisualization(call.to!)
        ]
      }
    case 'has-to:no-value:has-data':
    case 'has-to:has-value:has-data':
      const knownFunctionName = getKnownFunctionName(
        humanizerInfo as HumanizerMeta,
        call.data.slice(0, 10)
      )
      const capitalizedFunctionName = knownFunctionName
        ? `${knownFunctionName.charAt(0).toUpperCase()}${knownFunctionName.slice(1)}`
        : undefined
      let fullVisualization =
        call.fullVisualization ||
        (capitalizedFunctionName
          ? [getAction(capitalizedFunctionName), getLabel('on'), getAddressVisualization(call.to!)]
          : [getAction('Interacting'), getLabel('with'), getAddressVisualization(call.to!)])
      if (
        call.value &&
        !['Swap', 'Bridge', 'Swap/Bridge', 'Supply', 'Deposit', 'Supply to vault', 'Wrap'].includes(
          fullVisualization[0]?.content || ''
        )
      ) {
        fullVisualization = [
          getAction('Send'),
          getToken(ZeroAddress, call.value),
          getLabel('and'),
          ...fullVisualization
        ]
      }
      return {
        ...call,
        isFallback: !call.fullVisualization,
        fullVisualization
      }
    default:
      return { ...call, fullVisualization: [getAction('Empty call')] }
  }
}
