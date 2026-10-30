import { ZeroAddress } from 'ethers'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getKnownFunctionName,
  getLabel,
  getToken,
  getLegacyVisualization,
  mergeWarnings,
  showNativeValueOfCall
} from '../../utils'
import { ST_ETH_ADDRESS } from '../Lido'

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
      return {
        ...call,
        fullVisualization: getLegacyVisualization([getAction('Deploy'), getLabel('contract')])
      }
    case 'no-to:has-value:no-data':
    case 'no-to:has-value:has-data':
      return {
        ...call,
        fullVisualization: getLegacyVisualization([
          getAction('Deploy'),
          getLabel('contract'),
          getLabel('and'),
          getAction('Burn', { warning: true }),
          getToken(ZeroAddress, call.value)
        ])
      }
    case 'has-to:no-value:no-data':
      // preserve a visualization already set by an earlier, more specific module (e.g. a
      // Safe{WALLET} "cancel queued transaction" call) instead of unconditionally overwriting
      // it with a generic "Empty call to" label below
      if (call.fullVisualization) return call
      return {
        ...call,
        fullVisualization: getLegacyVisualization([
          getAction('Empty call to'),
          getAddressVisualization(call.to!)
        ])
      }
    case 'has-to:has-value:no-data':
      return {
        ...call,
        fullVisualization: getLegacyVisualization([
          getAction('Send'),
          getToken(ZeroAddress, call.value),
          getLabel('to'),
          getAddressVisualization(call.to!)
        ])
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
        call.fullVisualization?.intent ||
        (capitalizedFunctionName
          ? [getAction(capitalizedFunctionName), getLabel('on'), getAddressVisualization(call.to!)]
          : [getAction('Interacting'), getLabel('with'), getAddressVisualization(call.to!)])
      // The rows a module returned are kept, only the intent is the one built above
      const humanizedVisualization = {
        ...(call.fullVisualization ?? getLegacyVisualization(fullVisualization)),
        intent: fullVisualization
      }
      // Staking on Lido is sending the coin, so a row and a warning for the coin would only repeat
      // the action (the intent shows the staked amount)
      const isLidoStake =
        fullVisualization[0]?.content === 'Stake' &&
        call.to?.toLowerCase() === ST_ETH_ADDRESS.toLowerCase()
      // The coin the call sends is a row of its own, so the intent keeps describing the action
      const shouldShowNativeValue =
        !!call.value &&
        !isLidoStake &&
        !['Swap', 'Bridge', 'Swap/Bridge', 'Supply', 'Deposit', 'Supply to vault', 'Wrap'].includes(
          fullVisualization[0]?.content || ''
        )
      const { fullVisualization: visualizationWithNativeValue, warnings } = shouldShowNativeValue
        ? showNativeValueOfCall(humanizedVisualization, call.value, accountOp.chainId)
        : { fullVisualization: humanizedVisualization, warnings: [] }

      return {
        ...call,
        isFallback: !call.fullVisualization,
        fullVisualization: visualizationWithNativeValue,
        warnings: mergeWarnings(call.warnings, warnings)
      }
    default:
      return { ...call, fullVisualization: getLegacyVisualization([getAction('Empty call')]) }
  }
}
