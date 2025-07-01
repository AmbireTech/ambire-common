import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel } from '../../utils'

const CONTRACT_FACTORY_ADDRESS = '0xce0042B868300000d44A59004Da54A005ffdcf9f'
export const singletonFactory: HumanizerCallModule = (_: AccountOp, irCalls: IrCall[]) => {
  const iface = new Interface(['function  deploy(bytes,bytes32)'])
  const newCalls = irCalls.map((call) => {
    // @TODO fix those upper/lowercase
    if (
      call.to &&
      call.to.toLowerCase() === CONTRACT_FACTORY_ADDRESS.toLowerCase() &&
      call.data.slice(0, 10) === iface.getFunction('deploy')!.selector
    ) {
      return {
        ...call,
        fullVisualization: [
          getAction('Deploy a contract'),
          getLabel('via'),
          getAddressVisualization(CONTRACT_FACTORY_ADDRESS)
        ]
      }
    }
    return call
  })
  return newCalls
}
