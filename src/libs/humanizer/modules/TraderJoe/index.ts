import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { Router } from '../../const/abis/TraderJoe'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getDeadline, getLabel, getRecipientText, getToken } from '../../utils'

const traderJoeModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const iface = new Interface(Router)
  const matcher = {
    [iface.getFunction(
      'swapExactNATIVEForTokens(uint256 amountOutMin,(uint256[],uint8[],address[]) path,address to,uint256 deadline)'
    )?.selector!]: (call: IrCall) => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { amountOutMin, path, to, deadline } = iface.parseTransaction(call)!.args
      const tokenOut = path[2][path.length - 1]
      return [
        getAction('Swap'),
        getToken(ZeroAddress, call.value),
        getLabel('for'),
        getToken(tokenOut, amountOutMin),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    }
  }

  const newCalls = calls.map((call) => {
    if (call.fullVisualization || !matcher[call.data.slice(0, 10)]) return call
    return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) }
  })

  return [newCalls, []]
}

export default traderJoeModule
