import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { RouteProcessor } from '../../const/abis'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getLabel, getRecipientText, getToken } from '../../utils'

export const sushiSwapModule: HumanizerCallModule = (accountOp: AccountOp, irCalls: IrCall[]) => {
  const routeProcessorIface = new Interface(RouteProcessor)
  const matcher = {
    [`${routeProcessorIface.getFunction('processRoute')?.selector}`]: (
      _accountOp: AccountOp,
      call: IrCall
    ): IrCall => {
      const params = routeProcessorIface.parseTransaction(call)!.args
      let { tokenIn, tokenOut /* route */ } = params
      const { amountIn, amountOutMin, to } = params
      if (tokenIn.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
        tokenIn = ZeroAddress
      if (tokenOut.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
        tokenOut = ZeroAddress

      return {
        ...call,
        fullVisualization: [
          getAction('Swap'),
          getToken(tokenIn, amountIn),
          getLabel('for'),
          getToken(tokenOut, amountOutMin),
          ...getRecipientText(accountOp.accountAddr, to)
        ]
      }
    }
  }
  const newCalls: IrCall[] = irCalls.map((call: IrCall) => {
    if (matcher[call.data.slice(0, 10)]) {
      return matcher[call.data.slice(0, 10)](accountOp, call)
    }
    return call
  })
  return newCalls
}
