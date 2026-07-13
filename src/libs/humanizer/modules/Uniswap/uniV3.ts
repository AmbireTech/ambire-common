import { type Hex, decodeFunctionData, parseAbi, toFunctionSelector, zeroAddress } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerVisualization } from '../../interfaces'
import {
  HexIrCall,
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getRecipientText,
  getToken
} from '../../utils'
import { HumanizerUniMatcher } from './interfaces'
import { getUniRecipientText, parsePath, uniReduce } from './utils'

// UniV3Router2 ABIs
const multicallDeadlineAbi = parseAbi([
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])'
])
const multicallBytesAbi = parseAbi([
  'function multicall(bytes[] data) payable returns (bytes[] results)'
])
const multicallPrevBlockHashAbi = parseAbi([
  'function multicall(bytes32 previousBlockhash, bytes[] data) payable returns (bytes[])'
])
const exactInputSingleNoDeadlineAbi = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)'
])
const exactInputSingleWithDeadlineAbi = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)'
])
const exactInputV32Abi = parseAbi([
  'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)'
])
const exactOutputSingleNoDeadlineAbi = parseAbi([
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)'
])
const exactOutputSingleWithDeadlineAbi = parseAbi([
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)'
])
const refundETHAbi = parseAbi(['function refundETH() payable'])
const exactOutputV32Abi = parseAbi([
  'function exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)'
])
const swapTokensForExactTokensV32Abi = parseAbi([
  'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to) payable returns (uint256 amountIn)'
])
const swapExactTokensForTokensV32Abi = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to) payable returns (uint256 amountOut)'
])
const unwrapWETH9NoRecipientAbi = parseAbi(['function unwrapWETH9(uint256 amountMinimum) payable'])
const unwrapWETH9WithRecipientAbi = parseAbi([
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable'
])
const sweepTokenNoRecipientAbi = parseAbi([
  'function sweepToken(address token, uint256 amountMinimum) payable'
])
const sweepTokenWithRecipientAbi = parseAbi([
  'function sweepToken(address token, uint256 amountMinimum, address recipient) payable'
])
const sweepTokenWithFeeNoRecipientAbi = parseAbi([
  'function sweepTokenWithFee(address token, uint256 amountMinimum, uint256 feeBips, address feeRecipient) payable'
])
const sweepTokenWithFeeWithRecipientAbi = parseAbi([
  'function sweepTokenWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable'
])
const mintV32Abi = parseAbi([
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
])

// UniV3Router ABIs
const exactInputV3Abi = parseAbi([
  'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)'
])
const exactOutputV3Abi = parseAbi([
  'function exactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)'
])
const unwrapWETH9WithFeeAbi = parseAbi([
  'function unwrapWETH9WithFee(uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable'
])

const uniV3Mapping = (): HumanizerUniMatcher => {
  return {
    // 0x5ae401dc
    [toFunctionSelector(multicallDeadlineAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in uniswap humanizer when !call.to')
      const { args } = decodeFunctionData({ abi: multicallDeadlineAbi, data: call.data })
      const [deadline, calls] = args
      const mappingResult = uniV3Mapping()
      const parsed: HumanizerVisualization[][] = calls.map(
        (data: Hex): HumanizerVisualization[] => {
          const sigHash = data.slice(0, 10)
          const humanizer = mappingResult[sigHash]
          return humanizer ? humanizer(accountOp, { ...call, data }) : [getAction('Uniswap action')]
        }
      )
      const res = uniReduce(parsed)
      return res.length
        ? [...res, getDeadline(deadline)]
        : [getAction('Uniswap action'), getLabel('to'), getAddressVisualization(call.to)]
    },
    // 0xac9650d8
    [toFunctionSelector(multicallBytesAbi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({ abi: multicallBytesAbi, data: call.data })
      const [calls] = args
      const mappingResult = uniV3Mapping()
      const parsed = calls.map((data: Hex): HumanizerVisualization[] => {
        const sigHash = data.slice(0, 10)
        const humanizer = mappingResult[sigHash]
        return humanizer ? humanizer(accountOp, { ...call, data }) : [getAction('Uniswap action')]
      })
      return uniReduce(parsed)
    },
    // 0x1f0464d1
    [toFunctionSelector(multicallPrevBlockHashAbi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      if (!call.to) throw Error('Humanizer: should not be in uniswap humanizer when !call.to')
      const { args } = decodeFunctionData({
        abi: multicallPrevBlockHashAbi,
        data: call.data
      })
      const [, calls] = args
      const mappingResult = uniV3Mapping()
      const parsed: HumanizerVisualization[][] = calls.map(
        (data: Hex): HumanizerVisualization[] => {
          const sigHash = data.slice(0, 10)
          const humanizer = mappingResult[sigHash]
          return humanizer ? humanizer(accountOp, { ...call, data }) : [getAction('Uniswap action')]
        }
      )
      return parsed.length
        ? uniReduce(parsed)
        : [getAction('Uniswap action'), getLabel('to'), getAddressVisualization(call.to)]
    },
    // NOTE: selfPermit is not supported cause it requires an ecrecover signature
    // 0x04e45aaf
    [toFunctionSelector(exactInputSingleNoDeadlineAbi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({
        abi: exactInputSingleNoDeadlineAbi,
        data: call.data
      })
      const [params] = args
      // @TODO: consider fees
      return [
        getAction('Swap'),
        getToken(params.tokenIn, 0n),
        getLabel('for'),
        getToken(params.tokenOut, 0n),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient)
      ]
    },
    // 0x414bf389
    [toFunctionSelector(exactInputSingleWithDeadlineAbi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({
        abi: exactInputSingleWithDeadlineAbi,
        data: call.data
      })
      const [params] = args
      return [
        getAction('Swap'),
        getToken(params.tokenIn, 0n),
        getLabel('for'),
        getToken(params.tokenOut, 0n),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient),
        getDeadline(params.deadline)
      ]
    },
    // 0xb858183f
    [toFunctionSelector(exactInputV32Abi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({ abi: exactInputV32Abi, data: call.data })
      const [params] = args
      const path = parsePath(params.path)
      if (!path.length) return []
      return [
        getAction('Swap'),
        getToken(path[0]!, 0n),
        getLabel('for'),
        getToken(path[path.length - 1]!, 0n),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient)
      ]
    },
    // 0x5023b4df
    [toFunctionSelector(exactOutputSingleNoDeadlineAbi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({
        abi: exactOutputSingleNoDeadlineAbi,
        data: call.data
      })
      const [params] = args
      return [
        getAction('Swap'),
        getToken(params.tokenIn, 0n),
        getLabel('for'),
        getToken(params.tokenOut, 0n),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient)
      ]
    },
    // 0xdb3e2198
    [toFunctionSelector(exactOutputSingleWithDeadlineAbi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({
        abi: exactOutputSingleWithDeadlineAbi,
        data: call.data
      })
      const [params] = args
      return [
        getAction('Swap'),
        getToken(params.tokenIn, 0n),
        getLabel('for'),
        getToken(params.tokenOut, 0n),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient),
        getDeadline(params.deadline)
      ]
    },

    // 0x12210e8a
    [toFunctionSelector(refundETHAbi[0])]: (
      _accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      return [getAction('Withdraw'), getToken(zeroAddress, call.value)]
    },
    // 0x09b81346
    [toFunctionSelector(exactOutputV32Abi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({ abi: exactOutputV32Abi, data: call.data })
      const [params] = args
      const path = parsePath(params.path)
      if (!path.length) return []
      return [
        getAction('Swap'),
        getToken(path[path.length - 1]!, 0n),
        getLabel('for'),
        getToken(path[0]!, 0n),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient)
      ]
    },
    // 0x42712a67
    [toFunctionSelector(swapTokensForExactTokensV32Abi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({
        abi: swapTokensForExactTokensV32Abi,
        data: call.data
      })
      const [, , path, to] = args
      const firstToken = path[0]
      const lastToken = path[path.length - 1]
      if (!firstToken || !lastToken) throw new Error('UniV3: missing tokens in path')
      return [
        getAction('Swap'),
        getToken(firstToken, 0n),
        getLabel('for'),
        getToken(lastToken, 0n),
        ...getUniRecipientText(accountOp.accountAddr, to)
      ]
    },
    // 0x472b43f3
    [toFunctionSelector(swapExactTokensForTokensV32Abi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({
        abi: swapExactTokensForTokensV32Abi,
        data: call.data
      })
      const [, , path, to] = args
      const firstToken = path[0]
      const lastToken = path[path.length - 1]
      if (!firstToken || !lastToken) throw new Error('UniV3: missing tokens in path')
      return [
        getAction('Swap'),
        getToken(firstToken, 0n),
        getLabel('for'),
        getToken(lastToken, 0n),
        ...getUniRecipientText(accountOp.accountAddr, to)
      ]
    },
    // 0x49616997
    [toFunctionSelector(unwrapWETH9NoRecipientAbi[0])]: (): HumanizerVisualization[] => {
      return [getAction('Unwrap'), getToken(zeroAddress, 0n)]
    },
    // 0x49404b7c
    [toFunctionSelector(unwrapWETH9WithRecipientAbi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({
        abi: unwrapWETH9WithRecipientAbi,
        data: call.data
      })
      const [, recipient] = args
      return [
        getAction('Unwrap'),
        getToken(zeroAddress, 0n),
        ...getUniRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    // 0xe90a182f
    [toFunctionSelector(sweepTokenNoRecipientAbi[0])]: (
      _accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({
        abi: sweepTokenNoRecipientAbi,
        data: call.data
      })
      const [token] = args
      return [getAction('Sweep'), getToken(token, 0n)]
    },
    // 0xdf2ab5bb
    [toFunctionSelector(sweepTokenWithRecipientAbi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({
        abi: sweepTokenWithRecipientAbi,
        data: call.data
      })
      const [token, , recipient] = args
      return [
        getAction('Sweep'),
        getToken(token, 0n),
        ...getUniRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    // 0x3068c554
    [toFunctionSelector(sweepTokenWithFeeNoRecipientAbi[0])]: (
      _accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({
        abi: sweepTokenWithFeeNoRecipientAbi,
        data: call.data
      })
      const [token, , feeBips, feeRecipient] = args
      return [
        getAction('Sweep'),
        getToken(token, 0n),
        getLabel('with fee'),
        getToken(token, feeBips),
        getLabel('to'),
        getAddressVisualization(feeRecipient)
      ]
    },
    // 0xe0e189a0
    [toFunctionSelector(sweepTokenWithFeeWithRecipientAbi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({
        abi: sweepTokenWithFeeWithRecipientAbi,
        data: call.data
      })
      const [token, , recipient, feeBips, feeRecipient] = args
      return [
        getAction('Sweep'),
        getToken(token, 0n),
        getLabel('with fee'),
        getToken(token, feeBips),
        getLabel('to'),
        getAddressVisualization(feeRecipient),
        ...getUniRecipientText(accountOp.accountAddr, recipient)
      ]
    },
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
    },
    // -------------------------------------------------------------------------------------------------
    // NOTE: selfPermit is not supported cause it requires an ecrecover signature
    // 0xc04b8d59
    [toFunctionSelector(exactInputV3Abi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({ abi: exactInputV3Abi, data: call.data })
      const [params] = args
      const path = parsePath(params.path)
      if (!path.length) return []
      return [
        getAction('Swap'),
        getToken(path[0]!, 0n),
        getLabel('for'),
        getToken(path[path.length - 1]!, 0n),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient),
        getDeadline(params.deadline)
      ]
    },
    // 0xf28c0498
    [toFunctionSelector(exactOutputV3Abi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({ abi: exactOutputV3Abi, data: call.data })
      const [params] = args
      const path = parsePath(params.path)
      if (!path.length) return []
      return [
        getAction('Swap'),
        getToken(path[path.length - 1]!, 0n),
        getLabel('for'),
        getToken(path[0]!, 0n),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient),
        getDeadline(params.deadline)
      ]
    },
    // 0x9b2c0a37
    [toFunctionSelector(unwrapWETH9WithFeeAbi[0])]: (
      accountOp: AccountOp,
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({ abi: unwrapWETH9WithFeeAbi, data: call.data })
      const [, recipient, feeBips, feeRecipient] = args
      return [
        getAction('Unwrap'),
        getToken(zeroAddress, 0n),
        getLabel('with fee'),
        getToken(zeroAddress, feeBips),
        getLabel('to'),
        getAddressVisualization(feeRecipient),
        ...getUniRecipientText(accountOp.accountAddr, recipient)
      ]
    }
  }
}

export { uniV3Mapping }
