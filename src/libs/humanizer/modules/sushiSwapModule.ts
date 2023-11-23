import { AccountOp } from 'libs/accountOp/accountOp'
import { ethers } from 'ethers'
import { HumanizerCallModule, IrCall } from '../interfaces'
import { getAction, getLabel, getRecipientText, getToken, getUnknownVisualization } from '../utils'

export const sushiSwapModule: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  //   const sushiSwapIface = new ethers.Interface(accountOp.humanizerMeta?.['abis:SushiSwap'])
  const routeProcessorIface = new ethers.Interface(accountOp.humanizerMeta?.['abis:RouteProcessor'])
  const matcher = {
    [`${routeProcessorIface.getFunction('processRoute')?.selector}`]: (
      _accountOp: AccountOp,
      call: IrCall
    ): IrCall => {
      const { tokenIn, amountIn, tokenOut, amountOutMin, to /* route */ } =
        routeProcessorIface.parseTransaction(call)!.args

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
    if (call.fullVisualization) return call
    if (
      accountOp.humanizerMeta?.[`names:${call.to}`]?.includes('SushiSwap') ||
      accountOp.humanizerMeta?.[`names:${call.to}`]?.includes('RouterProcessor')
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
