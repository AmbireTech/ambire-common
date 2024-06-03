import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, IrCall } from '../interfaces'
import {
  getAction,
  getKnownName,
  getLabel,
  getRecipientText,
  getToken,
  getUnknownVisualization
} from '../utils'

const RouteProcessor = [
  'function bentoBox() view returns (address)',
  'function owner() view returns (address)',
  'function pause()',
  'function processRoute(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOutMin, address to, bytes route) payable returns (uint256 amountOut)',
  'function renounceOwnership()',
  'function resume()',
  'function setPriviledge(address user, bool priviledge)',
  'function transferOwnership(address newOwner)',
  'function transferValueAndprocessRoute(address transferValueTo, uint256 amountValueTransfer, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOutMin, address to, bytes route) payable returns (uint256 amountOut)',
  'function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes data)'
]
export const sushiSwapModule: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  humanizerMeta: HumanizerMeta,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const routeProcessorIface = new Interface(RouteProcessor)
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
