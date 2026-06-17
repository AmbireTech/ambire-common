import { decodeFunctionData, parseAbi, toFunctionSelector, zeroAddress } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { HexIrCall, getAction, getLabel, getToken, isHexCall } from '../../utils'

const exchangeAbi = parseAbi([
  'function exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _expected, address[5] _pools)'
])

const curveModule: HumanizerCallModule = (_: AccountOp, calls: IrCall[]) => {
  const parseCurveNative = (address: string) =>
    address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? zeroAddress : address

  const handleBasicSwap = (curveRoute: readonly string[], amountIn: bigint, amountOut: bigint) => {
    const route = curveRoute.filter((a: string) => a !== zeroAddress)
    const [inToken, outToken] = [route[0], route[route.length - 1]]
    return [
      getAction('Swap'),
      getToken(parseCurveNative(inToken!), amountIn),
      getLabel('for'),
      getToken(parseCurveNative(outToken!), amountOut)
    ]
  }

  const matcher: Record<string, (call: HexIrCall) => any> = {
    [toFunctionSelector(exchangeAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: exchangeAbi, data: call.data })
      const [_route, , _amount, _expected] = args
      return handleBasicSwap(_route, _amount, _expected)
    }
  }

  const newCalls = calls.map((call) => {
    const match = matcher[call.data.slice(0, 10)]
    if (call.fullVisualization || !isHexCall(call) || !match) return call
    return { ...call, fullVisualization: match(call) }
  })

  return newCalls
}

export default curveModule
