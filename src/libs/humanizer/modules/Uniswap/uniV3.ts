import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerVisualization } from '../../interfaces'
import {
  HexIrCall,
  getAction,
  getDeadline,
  getLabel,
  getRecipientText,
  getToken
} from '../../utils'
import { HumanizerUniMatcher } from './interfaces'

// UniV3Router2 ABIs
export const multicallDeadlineAbi = parseAbi([
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])'
])
export const multicallBytesAbi = parseAbi([
  'function multicall(bytes[] data) payable returns (bytes[] results)'
])
export const multicallPrevBlockHashAbi = parseAbi([
  'function multicall(bytes32 previousBlockhash, bytes[] data) payable returns (bytes[])'
])
export const exactInputSingleNoDeadlineAbi = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)'
])
export const exactInputSingleWithDeadlineAbi = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)'
])
export const exactInputV32Abi = parseAbi([
  'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)'
])
export const exactOutputSingleNoDeadlineAbi = parseAbi([
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)'
])
export const exactOutputSingleWithDeadlineAbi = parseAbi([
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)'
])
export const refundETHAbi = parseAbi(['function refundETH() payable'])
export const exactOutputV32Abi = parseAbi([
  'function exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)'
])
export const swapTokensForExactTokensV32Abi = parseAbi([
  'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to) payable returns (uint256 amountIn)'
])
export const swapExactTokensForTokensV32Abi = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to) payable returns (uint256 amountOut)'
])
export const unwrapWETH9NoRecipientAbi = parseAbi([
  'function unwrapWETH9(uint256 amountMinimum) payable'
])
export const unwrapWETH9WithRecipientAbi = parseAbi([
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable'
])
export const sweepTokenNoRecipientAbi = parseAbi([
  'function sweepToken(address token, uint256 amountMinimum) payable'
])
export const sweepTokenWithRecipientAbi = parseAbi([
  'function sweepToken(address token, uint256 amountMinimum, address recipient) payable'
])
export const sweepTokenWithFeeNoRecipientAbi = parseAbi([
  'function sweepTokenWithFee(address token, uint256 amountMinimum, uint256 feeBips, address feeRecipient) payable'
])
export const sweepTokenWithFeeWithRecipientAbi = parseAbi([
  'function sweepTokenWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable'
])
const mintV32Abi = parseAbi([
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
])

// UniV3Router ABIs
export const exactInputV3Abi = parseAbi([
  'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)'
])
export const exactOutputV3Abi = parseAbi([
  'function exactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)'
])
export const unwrapWETH9WithFeeAbi = parseAbi([
  'function unwrapWETH9WithFee(uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable'
])

export const uniV3Mapping: HumanizerUniMatcher = {
  // 0x88316456
  [toFunctionSelector(mintV32Abi[0])]: (
    accountOp: AccountOp,
    call: HexIrCall
  ): HumanizerVisualization[] => {
    const { args } = decodeFunctionData({ abi: mintV32Abi, data: call.data })
    const [params] = args
    return [
      getAction('Add liquidity'),
      getToken(params.token0, params.amount0Desired),
      getToken(params.token1, params.amount1Desired),
      getLabel('pair'),
      ...getRecipientText(accountOp.accountAddr, params.recipient),
      getDeadline(params.deadline)
    ]
  }
}
