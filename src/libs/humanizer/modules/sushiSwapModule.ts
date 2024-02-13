import { AccountOp } from 'libs/accountOp/accountOp'
import { ethers } from 'ethers'
import { HumanizerCallModule, IrCall } from '../interfaces'
import {
  getKnownAbi,
  getAction,
  getLabel,
  getRecipientText,
  getToken,
  getUnknownVisualization,
  getKnownName
} from '../utils'

export const sushiSwapModule: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const routeProcessorIface = new ethers.Interface(
    Object.values(getKnownAbi(accountOp.humanizerMeta, 'RouteProcessor', options))
  )
  const matcher = {
    [`${routeProcessorIface.getFunction('processRoute')?.selector}`]: (
      _accountOp: AccountOp,
      call: IrCall
    ): IrCall => {
      const params = routeProcessorIface.parseTransaction(call)!.args
      let { tokenIn, tokenOut /* route */ } = params
      const { amountIn, amountOutMin, to } = params
      if (tokenIn === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') tokenIn = ethers.ZeroAddress
      if (tokenOut === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') tokenOut = ethers.ZeroAddress

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
      getKnownName(accountOp.humanizerMeta, call.to)?.includes('SushiSwap') ||
      getKnownName(accountOp.humanizerMeta, call.to)?.includes('RouterProcessor')
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
