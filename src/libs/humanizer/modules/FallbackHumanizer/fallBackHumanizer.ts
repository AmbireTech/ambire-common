import { ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils'

export const fallbackHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[]
) => {
  const newCalls = currentIrCalls.map((call): IrCall => {
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
        let fullVisualization = call.fullVisualization || [
          getAction('Interacting'),
          getLabel('with'),
          getAddressVisualization(call.to!)
        ]
        if (
          call.value &&
          ![
            'Swap',
            'Bridge',
            'Swap/Bridge',
            'Supply',
            'Deposit',
            'Supply to vault',
            'Wrap'
          ].includes(fullVisualization[0]?.content || '')
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
  })

  return newCalls
}
