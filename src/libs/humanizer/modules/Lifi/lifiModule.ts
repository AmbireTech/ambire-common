/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { Lifi } from '../../const/abis'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel } from '../../utils'

const LIFI_ROUTER = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
export const LifiModule: HumanizerCallModule = (accountOp: AccountOp, irCalls: IrCall[]) => {
  const iface = new Interface(Lifi)
  const newCalls: IrCall[] = irCalls.map((call: IrCall) => {
    if (call.to && call.to.toLowerCase() === LIFI_ROUTER.toLowerCase()) {
      return {
        ...call,
        fullVisualization: [
          getAction('Swap/Bridge'),
          getLabel('with'),
          getAddressVisualization(call.to)
        ]
      }
    }
    return call
  })
  return newCalls
}
