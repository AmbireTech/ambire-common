import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  HexIrCall,
  eToNative,
  getAction,
  getLabel,
  getRecipientText,
  getToken,
  isHexCall
} from '../../utils'

const processRouteAbi = parseAbi([
  'function processRoute(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOutMin, address to, bytes route) payable returns (uint256 amountOut)'
])

export const sushiSwapModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  const matcher = {
    [toFunctionSelector(processRouteAbi[0])]: (call: HexIrCall): IrCall => {
      const { args } = decodeFunctionData({ abi: processRouteAbi, data: call.data })
      const [tokenInRaw, amountIn, tokenOutRaw, amountOutMin, to] = args
      const tokenIn = eToNative(tokenInRaw)
      const tokenOut = eToNative(tokenOutRaw)

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
  if (!isHexCall(call)) return call
  const match = matcher[call.data.slice(0, 10)]
  if (!match) return call
  return match(call)
}
