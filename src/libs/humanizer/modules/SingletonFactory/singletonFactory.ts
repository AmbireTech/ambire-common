import { parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel } from '../../utils'

const CONTRACT_FACTORY_ADDRESS = '0xce0042B868300000d44A59004Da54A005ffdcf9f'
const deployAbi = parseAbi(['function deploy(bytes,bytes32)'])

export const singletonFactory: HumanizerCallModule = (_: AccountOp, call: IrCall) => {
  // @TODO fix those upper/lowercase
  if (
    call.to &&
    call.to.toLowerCase() === CONTRACT_FACTORY_ADDRESS.toLowerCase() &&
    call.data.slice(0, 10) === toFunctionSelector(deployAbi[0])
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
}
