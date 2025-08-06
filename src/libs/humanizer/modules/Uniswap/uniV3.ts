import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { UniV3Router, UniV3Router2 } from '../../const/abis'
import { HumanizerVisualization, IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getRecipientText,
  getToken
} from '../../utils'
import { HumanizerUniMatcher } from './interfaces'
import { getUniRecipientText, parsePath, uniReduce } from './utils'

const uniV32Mapping = (): HumanizerUniMatcher => {
  const ifaceV32 = new Interface(UniV3Router2)
  return {
    // 0x5ae401dc
    [ifaceV32.getFunction('multicall(uint256 deadline,bytes[])')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      if (!call.to) throw Error('Humanizer: should not be in uniswap humanizer when !call.to')
      const [deadline, calls] = ifaceV32.parseTransaction(call)?.args || []
      const mappingResult = uniV32Mapping()
      const parsed: HumanizerVisualization[][] = calls.map(
        (data: string): HumanizerVisualization[] => {
          const sigHash = data.slice(0, 10)
          const humanizer = mappingResult[sigHash]
          return humanizer ? humanizer(accountOp, { ...call, data }) : [getAction('Unknown action')]
        }
      )
      const res = uniReduce(parsed)
      return res.length
        ? [...res, getDeadline(deadline)]
        : [getAction('Uniswap action'), getLabel('to'), getAddressVisualization(call.to)]
    },
    // 0xac9650d8
    [ifaceV32.getFunction('multicall(bytes[])')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [calls] = ifaceV32.parseTransaction(call)?.args || []
      const mappingResult = uniV32Mapping()
      const parsed = calls.map((data: string): HumanizerVisualization[] => {
        const sigHash = data.slice(0, 10)

        const humanizer = mappingResult[sigHash]
        return humanizer ? humanizer(accountOp, { ...call, data }) : [getAction('Unknown action')]
      })
      return uniReduce(parsed)
    },
    // 0x1f0464d1
    [ifaceV32.getFunction('multicall(bytes32 prevBlockHash, bytes[])')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      if (!call.to) throw Error('Humanizer: should not be in uniswap humanizer when !call.to')

      const [, calls] = ifaceV32.parseTransaction(call)?.args || []
      const mappingResult = uniV32Mapping()
      const parsed: HumanizerVisualization[][] = calls.map(
        (data: string): HumanizerVisualization[] => {
          const sigHash = data.slice(0, 10)
          const humanizer = mappingResult[sigHash]
          return humanizer ? humanizer(accountOp, { ...call, data }) : [getAction('Unknown action')]
        }
      )
      return parsed.length
        ? uniReduce(parsed)
        : [getAction('Uniswap action'), getLabel('to'), getAddressVisualization(call.to)]
    },
    // NOTE: selfPermit is not supported cause it requires an ecrecover signature
    // 0x04e45aaf
    [ifaceV32.getFunction(
      'exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96))'
    )?.selector!]: (accountOp: AccountOp, call: IrCall): HumanizerVisualization[] => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      // @TODO: consider fees
      return [
        getAction('Swap'),
        getToken(params.tokenIn, params.amountIn),
        getLabel('for at least'),
        getToken(params.tokenOut, params.amountOutMinimum),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient)
      ]
    },
    // 0x414bf389
    [ifaceV32.getFunction(
      'exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96))'
    )?.selector!]: (accountOp: AccountOp, call: IrCall): HumanizerVisualization[] => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []

      return [
        getAction('Swap'),
        getToken(params.tokenIn, params.amountIn),
        getLabel('for at least'),
        getToken(params.tokenOut, params.amountOutMinimum),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient),
        getDeadline(params.deadline)
      ]
    },
    // 0xb858183f
    [ifaceV32.getFunction('exactInput')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        getAction('Swap'),
        getToken(path[0], params.amountIn),
        getLabel('for at least'),
        getToken(path[path.length - 1], params.amountOutMinimum),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient)
      ]
    },
    // 0x5023b4df
    [ifaceV32.getFunction(
      'exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params)'
    )?.selector!]: (accountOp: AccountOp, call: IrCall): HumanizerVisualization[] => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Swap up to'),
        getToken(params.tokenIn, params.amountInMaximum),
        getLabel('for'),
        getToken(params.tokenOut, params.amountOut),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient)
      ]
    },
    // 0xdb3e2198
    [ifaceV32.getFunction(
      'exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params)'
    )?.selector!]: (accountOp: AccountOp, call: IrCall): HumanizerVisualization[] => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Swap up to'),
        getToken(params.tokenIn, params.amountInMaximum),
        getLabel('for'),
        getToken(params.tokenOut, params.amountOut),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient),
        getDeadline(params.deadline)
      ]
    },

    // 0x12210e8a
    [ifaceV32.getFunction('refundETH()')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      return [getAction('Withdraw'), getToken(ZeroAddress, call.value)]
    },
    // 0x09b81346
    [ifaceV32.getFunction('exactOutput')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [params] = ifaceV32.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        getAction('Swap up to'),
        getToken(path[path.length - 1], params.amountInMaximum),
        getLabel('for'),
        getToken(path[0], params.amountOut),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient)
      ]
    },
    // 0x42712a67
    [ifaceV32.getFunction('swapTokensForExactTokens')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [amountOut, amountInMax, path, to] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Swap up to'),
        getToken(path[0], amountInMax),
        getLabel('for'),
        getToken(path[path.length - 1], amountOut),
        ...getUniRecipientText(accountOp.accountAddr, to)
      ]
    },
    // 0x472b43f3
    [ifaceV32.getFunction('swapExactTokensForTokens')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [amountIn, amountOutMin, path, to] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Swap'),
        getToken(path[0], amountIn),
        getLabel('for at least'),
        getToken(path[path.length - 1], amountOutMin),
        ...getUniRecipientText(accountOp.accountAddr, to)
      ]
    },
    // 0x49616997
    [ifaceV32.getFunction('unwrapWETH9(uint256)')?.selector!]: (
      _accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [amountMin] = ifaceV32.parseTransaction(call)?.args || []
      return [getAction('Unwrap'), getToken(ZeroAddress, amountMin)]
    },
    // 0x49404b7c
    [ifaceV32.getFunction('unwrapWETH9(uint256,address recipient)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [amountMin, recipient] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Unwrap'),
        getToken(ZeroAddress, amountMin),
        ...getUniRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    // 0xe90a182f
    [ifaceV32.getFunction('sweepToken(address,uint256)')?.selector!]: (
      _accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [token, amountMinimum] = ifaceV32.parseTransaction(call)?.args || []
      return [getAction('Sweep'), getLabel('at least'), getToken(token, amountMinimum)]
    },
    // 0xdf2ab5bb
    [ifaceV32.getFunction('sweepToken(address,uint256,address)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [token, amountMinimum, recipient] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Sweep'),
        getLabel('at least'),
        getToken(token, amountMinimum),
        ...getUniRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    // 0x3068c554
    [ifaceV32.getFunction('sweepTokenWithFee(address,uint256,uint256,address)')?.selector!]: (
      _accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [token, amountMinimum, feeBips, feeRecipient] =
        ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Sweep'),
        getLabel('at least'),
        getToken(token, amountMinimum),
        getLabel('with fee'),
        getToken(token, feeBips),
        getLabel('to'),
        getAddressVisualization(feeRecipient)
      ]
    },
    // 0xe0e189a0
    [`${
      ifaceV32.getFunction('sweepTokenWithFee(address,uint256,address,uint256,address)')?.selector
    }`]: (accountOp: AccountOp, call: IrCall): HumanizerVisualization[] => {
      const [token, amountMinimum, recipient, feeBips, feeRecipient] =
        ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Sweep'),
        getLabel('at least'),
        getToken(token, amountMinimum),
        getLabel('with fee'),
        getToken(token, feeBips),
        getLabel('to'),
        getAddressVisualization(feeRecipient),
        ...getUniRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    // 0x88316456
    [`${
      ifaceV32.getFunction(
        'mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))'
      )?.selector
    }`]: (accountOp: AccountOp, call: IrCall): HumanizerVisualization[] => {
      const [
        [
          token0,
          token1,
          ,
          ,
          ,
          ,
          ,
          // fee,
          // tickLower,
          // tickUpper,
          // amount0Desired,
          // amount1Desired,
          amount0Min,
          amount1Min,
          recipient,
          deadline
        ]
      ] = ifaceV32.parseTransaction(call)?.args || []
      return [
        getAction('Add liquidity'),
        getToken(token0, amount0Min),
        getToken(token1, amount1Min),
        getLabel('pair'),
        ...getRecipientText(accountOp.accountAddr, recipient),
        getDeadline(deadline)
      ]
    }
  }
}

const uniV3Mapping = (): HumanizerUniMatcher => {
  const ifaceV3 = new Interface(UniV3Router)
  return {
    // 0xac9650d8
    [ifaceV3.getFunction('multicall')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      if (!call.to) throw Error('Humanizer: should not be in uniswap humanizer when !call.to')

      const args = ifaceV3.parseTransaction(call)?.args || []
      const calls = args[args.length - 1]
      const mappingResult = uniV3Mapping()
      const parsed = calls.map((data: string): HumanizerVisualization[] => {
        const sigHash = data.slice(0, 10)
        const humanizer = mappingResult[sigHash]
        return humanizer ? humanizer(accountOp, { ...call, data }) : [getAction('Unknown action')]
      })

      return parsed.length
        ? uniReduce(parsed)
        : [getAction('Uniswap action'), getLabel('to'), getAddressVisualization(call.to)]
    },
    // -------------------------------------------------------------------------------------------------
    // NOTE: selfPermit is not supported cause it requires an ecrecover signature
    // 0x414bf389
    [ifaceV3.getFunction('exactInputSingle')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      // @TODO: consider fees
      return [
        getAction('Swap'),
        getToken(params.tokenIn, params.amountIn),
        getLabel('for at least'),
        getToken(params.tokenOut, params.amountOutMinimum),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient),
        getDeadline(params.deadline)
      ]
    },
    // 0xc04b8d59
    [ifaceV3.getFunction('exactInput')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        getAction('Swap'),
        getToken(path[0], params.amountIn),
        getLabel('for at least'),
        getToken(path[path.length - 1], params.amountOutMinimum),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient),
        getDeadline(params.deadline)
      ]
    },
    // 0xdb3e2198
    [ifaceV3.getFunction('exactOutputSingle')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      return [
        getAction('Swap up to'),
        getToken(params.tokenIn, params.amountInMaximum),
        getLabel('for'),
        getToken(params.tokenOut, params.amountOut),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient),
        getDeadline(params.deadline)
      ]
    },
    // 0xf28c0498
    [ifaceV3.getFunction('exactOutput')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [params] = ifaceV3.parseTransaction(call)?.args || []
      const path = parsePath(params.path)
      return [
        getAction('Swap up to'),
        getToken(path[path.length - 1], params.amountInMaximum),
        getLabel('for'),
        getToken(path[0], params.amountOut),
        ...getUniRecipientText(accountOp.accountAddr, params.recipient),
        getDeadline(params.deadline)
      ]
    },
    // 0x49404b7c
    [ifaceV3.getFunction('unwrapWETH9')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [amountMin, recipient] = ifaceV3.parseTransaction(call)?.args || []
      return [
        getAction('Unwrap'),
        getToken(ZeroAddress, amountMin),
        ...getUniRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    // 0x9b2c0a37
    [ifaceV3.getFunction('unwrapWETH9WithFee')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const [amountMin, recipient, feeBips, feeRecipient] =
        ifaceV3.parseTransaction(call)?.args || []
      return [
        getAction('Unwrap'),
        getToken(ZeroAddress, amountMin),
        getLabel('with fee'),
        getToken(ZeroAddress, feeBips),
        getLabel('to'),
        getAddressVisualization(feeRecipient),
        ...getUniRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    // 0x12210e8a
    [ifaceV3.getFunction('refundETH()')?.selector!]: (): HumanizerVisualization[] => {
      return [getAction('Refund')]
    }
  }
}

export { uniV32Mapping, uniV3Mapping }
