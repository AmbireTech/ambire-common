import { decodeFunctionData, parseAbi, toFunctionSelector, zeroAddress } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { HexIrCall, getAction, getDeadline, getLabel, getRecipientText, getToken, isHexCall } from '../../utils'

// @TODO limit order manager
// @TODO those use AVAX in the function method
// https://snowtrace.io/address/0x60aE616a2155Ee3d9A68541Ba4544862310933d4
// https://arbiscan.io/address/0xbeE5c10Cf6E4F68f831E11C1D9E59B43560B3642
// https://arbiscan.io/address/0x7BFd7192E76D950832c77BB412aaE841049D8D9B

const swapExactNATIVEForTokensAbi = parseAbi([
  'function swapExactNATIVEForTokens(uint256 amountOutMin,(uint256[],uint8[],address[]) path,address to,uint256 deadline) payable returns (uint256)'
])
const swapNATIVEForExactTokensAbi = parseAbi([
  'function swapNATIVEForExactTokens(uint256 amountOut,(uint256[],uint8[],address[]) path,address to,uint256 deadline) payable returns (uint256[])'
])
const swapExactTokensForNATIVEAbi = parseAbi([
  'function swapExactTokensForNATIVE(uint256 amountIn,uint256 amountOutMinNATIVE,(uint256[],uint8[],address[]) path,address to,uint256 deadline) returns (uint256)'
])
const swapTokensForExactNATIVEAbi = parseAbi([
  'function swapTokensForExactNATIVE(uint256 amountNATIVEOut,uint256 amountInMax,(uint256[],uint8[],address[]) path,address to,uint256 deadline) returns (uint256[])'
])
const swapExactTokensForTokensAbi = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,(uint256[],uint8[],address[]) path,address to,uint256 deadline) returns (uint256)'
])
const swapTokensForExactTokensAbi = parseAbi([
  'function swapTokensForExactTokens(uint256 amountOut,uint256 amountInMax,(uint256[],uint8[],address[]) path,address to,uint256 deadline) returns (uint256[])'
])

const traderJoeModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const matcher = {
    [toFunctionSelector(swapExactNATIVEForTokensAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapExactNATIVEForTokensAbi,
        data: call.data
      })
      const [amountOutMin, path, to, deadline] = args
      if (!path[2]) throw new Error('Traderjoe module: Missing path[2]')
      const tokenOut = path[2].at(-1)
      if (!tokenOut) throw new Error('Traderjoe module: missing tokenOut')
      return [
        getAction('Swap'),
        getToken(zeroAddress, call.value),
        getLabel('for at least'),
        getToken(tokenOut, amountOutMin),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    },
    [toFunctionSelector(swapNATIVEForExactTokensAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapNATIVEForExactTokensAbi,
        data: call.data
      })
      const [amountOut, path, to, deadline] = args
      if (!path[2]) throw new Error('Traderjoe module: Missing path[2]')
      const tokenOut = path[2].at(-1)
      if (!tokenOut) throw new Error('Traderjoe module: missing tokenOut')
      return [
        getAction('Swap up to'),
        getToken(zeroAddress, call.value),
        getLabel('for'),
        getToken(tokenOut, amountOut),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    },
    [toFunctionSelector(swapExactTokensForNATIVEAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapExactTokensForNATIVEAbi,
        data: call.data
      })
      const [amountIn, amountOutMinNATIVE, path, to, deadline] = args
      if (!path[2]) throw new Error('Traderjoe module: Missing path[2]')
      const tokenIn = path[2][0]
      if (!tokenIn) throw new Error('Traderjoe module: missing tokenOut')

      return [
        getAction('Swap'),
        getToken(tokenIn, amountIn),
        getLabel('for at least'),
        getToken(zeroAddress, amountOutMinNATIVE),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    },
    [toFunctionSelector(swapTokensForExactNATIVEAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapTokensForExactNATIVEAbi,
        data: call.data
      })
      const [amountNATIVEOut, amountInMax, path, to, deadline] = args
      if (!path[2]) throw new Error('Traderjoe module: Missing path[2]')
      const tokenIn = path[2][0]
      if (!tokenIn) throw new Error('Traderjoe module: missing tokenIn')

      return [
        getAction('Swap up to'),
        getToken(tokenIn, amountInMax),
        getLabel('for'),
        getToken(zeroAddress, amountNATIVEOut),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    },
    [toFunctionSelector(swapExactTokensForTokensAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapExactTokensForTokensAbi,
        data: call.data
      })
      const [amountIn, amountOutMin, path, to, deadline] = args
      if (!path[2]) throw new Error('Traderjoe module: Missing path[2]')
      const tokenOut = path[2].at(-1)
      const tokenIn = path[2][0]
      if (!tokenOut || !tokenIn) throw new Error('Traderjoe module: missing tokenOut or tokenIn')

      return [
        getAction('Swap'),
        getToken(tokenIn, amountIn),
        getLabel('for at least'),
        getToken(tokenOut, amountOutMin),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    },
    [toFunctionSelector(swapTokensForExactTokensAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapTokensForExactTokensAbi,
        data: call.data
      })
      const [amountOut, amountInMax, path, to, deadline] = args
      if (!path[2]) throw new Error('Traderjoe module: Missing path[2]')
      const tokenOut = path[2].at(-1)
      const tokenIn = path[2][0]
      if (!tokenOut || !tokenIn) throw new Error('Traderjoe module: missing tokenOut or tokenIn')

      return [
        getAction('Swap up to'),
        getToken(tokenIn, amountInMax),
        getLabel('for'),
        getToken(tokenOut, amountOut),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    }
  }

  const newCalls = calls.map((call) => {
    if (!isHexCall(call)) return call
    const selector = call.data.slice(0, 10)
    if (call.fullVisualization || !matcher[selector]) return call
    return { ...call, fullVisualization: matcher[selector](call) }
  })

  return newCalls
}

export default traderJoeModule
