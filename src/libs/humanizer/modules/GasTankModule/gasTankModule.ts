import { AbiCoder, ZeroAddress } from 'ethers'

import { FEE_COLLECTOR } from '../../../../consts/addresses'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getToken, getLegacyVisualization } from '../../utils'

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
  } else if (
    call.fullVisualization?.intent[0]?.content === 'Send' &&
    call.fullVisualization?.intent[1]?.type === 'token' &&
    call.fullVisualization?.intent[2]?.content === 'to' &&
    call.fullVisualization?.intent[3]?.type === 'address' &&
    call.fullVisualization.intent[3].address!.toLowerCase() === FEE_COLLECTOR.toLowerCase()
  )
    return {
      ...call,
      fullVisualization: getLegacyVisualization([
        getAction('Fuel gas tank with'),
        call.fullVisualization.intent[1]
      ])
    }
  return call
}
