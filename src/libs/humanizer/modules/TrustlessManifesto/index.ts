import { getAddress, Interface, isAddress, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getLabel } from '../../utils'

const iface = new Interface(['function pledge()'])

const TrustlessManifestoModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const newCalls = calls.map((call) => {
    if (
      call.data &&
      call.data.startsWith(iface.getFunction('pledge')?.selector!) &&
      isAddress(call.to) &&
      getAddress(call.to) === '0x32AA964746ba2be65C71fe4A5cB3c4a023cA3e20'
    )
      return {
        ...call,
        fullVisualization: [
          getAction('Sign'),
          getLabel('the'),
          getLabel('Trustless Manifesto Pledge', true)
        ]
      }
    return call
  })

  return newCalls
}

export default TrustlessManifestoModule
