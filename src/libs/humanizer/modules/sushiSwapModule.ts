import { Interface, ZeroAddress } from 'ethers'
import { AccountOp } from '../../accountOp/accountOp'

import { HumanizerCallModule, HumanizerMeta, IrCall } from '../interfaces'
import {
  getAction,
  getKnownAbi,
  getKnownName,
  getLabel,
  getRecipientText,
  getToken,
  getUnknownVisualization
} from '../utils'

export const sushiSwapModule: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  humanizerMeta: HumanizerMeta,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const routeProcessorIface = new Interface(
    Object.values(getKnownAbi(humanizerMeta, 'RouteProcessor', options))
  )
  const matcher = {
    [`${routeProcessorIface.getFunction('processRoute')?.selector}`]: (
      _accountOp: AccountOp,
      call: IrCall
    ): IrCall => {
      const params = routeProcessorIface.parseTransaction(call)!.args
      let { tokenIn, tokenOut /* route */ } = params
      const { amountIn, amountOutMin, to } = params
      if (tokenIn === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') tokenIn = ZeroAddress
      if (tokenOut === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') tokenOut = ZeroAddress

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
    if (
      getKnownName(humanizerMeta, call.to)?.includes('SushiSwap') ||
      getKnownName(humanizerMeta, call.to)?.includes('RouterProcessor')
    ) {
      if (matcher[call.data.slice(0, 10)]) {
        return matcher[call.data.slice(0, 10)](accountOp, call)
      }
      return { ...call, fullVisualization: getUnknownVisualization('Sushiswap', call) }
    }
    return call
  })
  return [newCalls, []]
}
