import { decodeFunctionData, parseAbi, toFunctionSelector, zeroAddress } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HexIrCall, getAction, getDeadline, getLabel, getToken } from '../../utils'
import { HumanizerUniMatcher } from './interfaces'
import { getUniRecipientText } from './utils'

const swapExactTokensForTokensAbi = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)'
])
const swapTokensForExactTokensAbi = parseAbi([
  'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)'
])
const swapExactETHForTokensAbi = parseAbi([
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)'
])
const swapTokensForExactETHAbi = parseAbi([
  'function swapTokensForExactETH(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)'
])
const swapExactTokensForETHAbi = parseAbi([
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)'
])
const swapETHForExactTokensAbi = parseAbi([
  'function swapETHForExactTokens(uint256 amountOut, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)'
])
const addLiquidityAbi = parseAbi([
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)'
])
const addLiquidityETHAbi = parseAbi([
  'function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)'
])
const removeLiquidityAbi = parseAbi([
  'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)'
])
const removeLiquidityETHAbi = parseAbi([
  'function removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)'
])

export const uniV2Mapping: HumanizerUniMatcher = {
  // ordered in the same order as the router
  [toFunctionSelector(swapExactTokensForTokensAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
    const { args } = decodeFunctionData({
      abi: swapExactTokensForTokensAbi,
      data: call.data
    })
    const [, , path, to, deadline] = args
    const outputAsset = path[path.length - 1]
    if (!path[0] || !outputAsset) throw new Error('UniV2: missing assets in path')
    return [
      getAction('Swap'),
      getToken(path[0], 0n),
      getLabel('for'),
      getToken(outputAsset, 0n),
      ...getUniRecipientText(accountOp.accountAddr, to),
      getDeadline(deadline)
    ]
  },
  [toFunctionSelector(swapTokensForExactTokensAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
    const { args } = decodeFunctionData({
      abi: swapTokensForExactTokensAbi,
      data: call.data
    })
    const [, , path, to, deadline] = args
    const outputAsset = path[path.length - 1]
    if (!path[0] || !outputAsset) throw new Error('UniV2: missing assets in path')

    return [
      getAction('Swap'),
      getToken(path[0], 0n),
      getLabel('for'),
      getToken(outputAsset, 0n),
      ...getUniRecipientText(accountOp.accountAddr, to),
      getDeadline(deadline)
    ]
  },
  [toFunctionSelector(swapExactETHForTokensAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
    const { args } = decodeFunctionData({ abi: swapExactETHForTokensAbi, data: call.data })
    const [, path, to, deadline] = args
    const outputAsset = path[path.length - 1]
    if (!outputAsset) throw new Error('UniV2: missing assets in path')

    return [
      getAction('Swap'),
      getToken(zeroAddress, 0n),
      getLabel('for'),
      getToken(outputAsset, 0n),
      ...getUniRecipientText(accountOp.accountAddr, to),
      getDeadline(deadline)
    ]
  },
  [toFunctionSelector(swapTokensForExactETHAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
    const { args } = decodeFunctionData({ abi: swapTokensForExactETHAbi, data: call.data })
    const [, , path, to, deadline] = args
    if (!path[0]) throw new Error('UniV2: missing assets in path')

    return [
      getAction('Swap'),
      getToken(path[0], 0n),
      getLabel('for'),
      getToken(zeroAddress, 0n),
      ...getUniRecipientText(accountOp.accountAddr, to),
      getDeadline(deadline)
    ]
  },
  [toFunctionSelector(swapExactTokensForETHAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
    const { args } = decodeFunctionData({ abi: swapExactTokensForETHAbi, data: call.data })
    const [, , path, to, deadline] = args
    if (!path[0]) throw new Error('UniV2: missing assets in path')

    return [
      getAction('Swap'),
      getToken(path[0], 0n),
      getLabel('for'),
      getToken(zeroAddress, 0n),
      ...getUniRecipientText(accountOp.accountAddr, to),
      getDeadline(deadline)
    ]
  },
  [toFunctionSelector(swapETHForExactTokensAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
    const { args } = decodeFunctionData({ abi: swapETHForExactTokensAbi, data: call.data })
    const [, path, to, deadline] = args
    const outputAsset = path[path.length - 1]
    if (!outputAsset) throw new Error('UniV2: missing assets in path')

    return [
      getAction('Swap'),
      getToken(zeroAddress, 0n),
      getLabel('for'),
      getToken(outputAsset, 0n),
      ...getUniRecipientText(accountOp.accountAddr, to),
      getDeadline(deadline)
    ]
  },
  // Liquidity
  [toFunctionSelector(addLiquidityAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
    const { args } = decodeFunctionData({ abi: addLiquidityAbi, data: call.data })
    const [
      tokenA,
      tokenB,
      amountADesired,
      amountBDesired /* amountAMin */ /* amountBMin */,
      ,
      ,
      to,
      deadline
    ] = args
    return [
      getAction('Add liquidity'),
      getToken(tokenA, amountADesired),
      getLabel('and'),
      getToken(tokenB, amountBDesired),
      ...getUniRecipientText(accountOp.accountAddr, to),
      getDeadline(deadline)
    ]
  },
  [toFunctionSelector(addLiquidityETHAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
    const { args } = decodeFunctionData({ abi: addLiquidityETHAbi, data: call.data })
    const [token, amountTokenDesired /* amountTokenMin */ /* amountETHMin */, , , to, deadline] =
      args
    return [
      getAction('Add liquidity'),
      getToken(token, amountTokenDesired),
      getLabel('and'),
      getToken(zeroAddress, call.value),
      ...getUniRecipientText(accountOp.accountAddr, to),
      getDeadline(deadline)
    ]
  },
  [toFunctionSelector(removeLiquidityAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
    const { args } = decodeFunctionData({ abi: removeLiquidityAbi, data: call.data })
    const [tokenA, tokenB /* liquidity */, , amountAMin, amountBMin, to, deadline] = args
    return [
      getAction('Remove liquidity'),
      getLabel('at least'),
      getToken(tokenA, amountAMin),
      getLabel('and'),
      getToken(tokenB, amountBMin),
      ...getUniRecipientText(accountOp.accountAddr, to),
      getDeadline(deadline)
    ]
  },
  [toFunctionSelector(removeLiquidityETHAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
    const { args } = decodeFunctionData({ abi: removeLiquidityETHAbi, data: call.data })
    const [token /* liquidity */, , amountTokenMin, amountETHMin, to, deadline] = args
    return [
      getAction('Remove liquidity'),
      getLabel('at least'),
      getToken(token, amountTokenMin),
      getLabel('and'),
      getToken(zeroAddress, amountETHMin),
      ...getUniRecipientText(accountOp.accountAddr, to),
      getDeadline(deadline)
    ]
  }
  // NOTE: We currently do not support *WithPermit functions cause they require an ecrecover signature
  // Uniswap will detect we don't support it cause it will fail on requesting eth_signTypedData_v4
}
