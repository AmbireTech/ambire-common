import { AbiCoder, ZeroAddress } from 'ethers'

import { FEE_COLLECTOR } from '../../../../consts/addresses'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  flattenHumanizerVisualization,
  getAction,
  getLegacyVisualization,
  getToken
} from '../../utils'

export const gasTankModule: HumanizerCallModule = (_: AccountOp, call: IrCall) => {
  // @TODO fix those upper/lowercase
  if (call.to && call.to.toLowerCase() === FEE_COLLECTOR.toLowerCase()) {
    if (call.value > 0n) {
      return {
        ...call,
        fullVisualization: getLegacyVisualization([
          getAction('Fuel gas tank with'),
          getToken(ZeroAddress, call.value)
        ])
      }
    }
    try {
      const [text] = new AbiCoder().decode(['string', 'uint256', 'string'], call.data)
      // mostly useful for filtering out call in benzin
      if (text === 'gasTank')
        return {
          ...call,
          fullVisualization: getLegacyVisualization([getAction('Pay fee with gas tank')])
        }
    } catch (e) {
      // do nothing
    }
  } else if (call.fullVisualization?.intent[0]?.content === 'Send') {
    // The token and the recipient are in the intent of a flat visualization, and in the rows of a
    // rich one, so both are read from everything the visualization shows
    const items = flattenHumanizerVisualization(call.fullVisualization)
    const token = items.find((item) => item.type === 'token')
    const recipient = items.find((item) => item.type === 'address')
    if (token && recipient?.address?.toLowerCase() === FEE_COLLECTOR.toLowerCase())
      return {
        ...call,
        fullVisualization: getLegacyVisualization([getAction('Fuel gas tank with'), token])
      }
  }
  return call
}
