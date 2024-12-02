import { getAddress, Interface, isAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { WrappedStETH } from '../../const/abis/Lido'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getToken } from '../../utils'

const WRAPPED_ST_ETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
const ST_ETH_ADDRESS = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
export const LidoModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const iface = new Interface(WrappedStETH)
  const newCalls = calls.map((call) => {
    if (isAddress(call.to) && getAddress(call.to) === WRAPPED_ST_ETH_ADDRESS) {
      if (call.data.startsWith(iface.getFunction('wrap(uint256)')!.selector)) {
        const [amount] = iface.parseTransaction(call)!.args
        const fullVisualization = [getAction('Wrap'), getToken(ST_ETH_ADDRESS, amount)]
        return { ...call, fullVisualization }
      }
    }
    return call
  })

  return newCalls
}
