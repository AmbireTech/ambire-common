/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'
import { getAction, getDeadline, getLabel, getRecipientText, getToken } from '../../utils'

const UniV2Router = [
  'function WETH() view returns (address)',
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
  'function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)',
  'function factory() view returns (address)',
  'function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) pure returns (uint256 amountIn)',
  'function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) pure returns (uint256 amountOut)',
  'function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) pure returns (uint256 amountB)',
  'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)',
  'function removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)',
  'function removeLiquidityETHSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountETH)',
  'function removeLiquidityETHWithPermit(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountToken, uint256 amountETH)',
  'function removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountETH)',
  'function removeLiquidityWithPermit(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountA, uint256 amountB)',
  'function swapETHForExactTokens(uint256 amountOut, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapTokensForExactETH(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)'
]
const uniV2Mapping = (): { [key: string]: (a: AccountOp, c: IrCall) => IrCall[] } => {
  const iface = new Interface(UniV2Router)
  return {
    // ordered in the same order as the router
    [iface.getFunction('swapExactTokensForTokens')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [amountIn, amountOutMin, path, to, deadline] = iface.parseTransaction(call)?.args || []
      const outputAsset = path[path.length - 1]
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getToken(path[0], amountIn),
            getLabel('for at least'),
            getToken(outputAsset, amountOutMin),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadline(deadline)
          ]
        }
      ]
    },
    [iface.getFunction('swapTokensForExactTokens')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [amountOut, amountInMax, path, to, deadline] = iface.parseTransaction(call)?.args || []
      const outputAsset = path[path.length - 1]
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getLabel('up to'),
            getToken(path[0], amountInMax),
            getLabel('for at least'),
            getToken(outputAsset, amountOut),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadline(deadline)
          ]
        }
      ]
    },
    [iface.getFunction('swapExactETHForTokens')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const { args, value } = iface.parseTransaction(call) || { value: BigInt(0) }
      const [amountOutMin, path, to, deadline] = args || []
      const outputAsset = path[path.length - 1]
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getToken(ZeroAddress, value),
            getLabel('for at least'),
            getToken(outputAsset, amountOutMin),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadline(deadline)
          ]
        }
      ]
    },
    [iface.getFunction('swapTokensForExactETH')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [amountOut, amountInMax, path, to, deadline] = iface.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getLabel('up to'),
            getToken(path[0], amountInMax),
            getLabel('for at least'),
            getToken(ZeroAddress, amountOut),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadline(deadline)
          ]
        }
      ]
    },
    [iface.getFunction('swapExactTokensForETH')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [amountIn, amountOutMin, path, to, deadline] = iface.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getToken(path[0], amountIn),
            getLabel('for at least'),
            getToken(ZeroAddress, amountOutMin),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadline(deadline)
          ]
        }
      ]
    },
    [iface.getFunction('swapETHForExactTokens')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const { args, value } = iface.parseTransaction(call) || { value: BigInt(0) }
      const [amountOut, path, to, deadline] = args || []
      const outputAsset = path[path.length - 1]
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getLabel('up to'),
            getToken(ZeroAddress, value),
            getLabel('for at least'),
            getToken(outputAsset, amountOut),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadline(deadline)
          ]
        }
      ]
    },
    // Liquidity
    [iface.getFunction('addLiquidity')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [
        tokenA,
        tokenB,
        amountADesired,
        amountBDesired /* amountAMin */ /* amountBMin */,
        ,
        ,
        to,
        deadline
      ] = iface.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Add liquidity'),
            getToken(tokenA, amountADesired),
            getLabel('and'),
            getToken(tokenB, amountBDesired),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadline(deadline)
          ]
        }
      ]
    },
    [iface.getFunction('addLiquidityETH')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const { args, value } = iface.parseTransaction(call) || { args: [], value: BigInt(0) }
      const [token, amountTokenDesired /* amountTokenMin */ /* amountETHMin */, , , to, deadline] =
        args
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Add liquidity'),
            getToken(token, amountTokenDesired),
            getLabel('and'),
            getToken(ZeroAddress, value),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadline(deadline)
          ]
        }
      ]
    },
    [iface.getFunction('removeLiquidity')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [tokenA, tokenB /* liquidity */, , amountAMin, amountBMin, to, deadline] =
        iface.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Remove liquidity'),
            getLabel('at least'),
            getToken(tokenA, amountAMin),
            getLabel('and'),
            getToken(tokenB, amountBMin),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadline(deadline)
          ]
        }
      ]
    },
    [iface.getFunction('removeLiquidityETH')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ): IrCall[] => {
      const [token /* liquidity */, , amountTokenMin, amountETHMin, to, deadline] =
        iface.parseTransaction(call)?.args || []
      return [
        {
          ...call,
          fullVisualization: [
            getAction('Remove liquidity'),
            getLabel('at least'),
            getToken(token, amountTokenMin),
            getLabel('and'),
            getToken(ZeroAddress, amountETHMin),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadline(deadline)
          ]
        }
      ]
    }
    // NOTE: We currently do not support *WithPermit functions cause they require an ecrecover signature
    // Uniswap will detect we don't support it cause it will fail on requesting eth_signTypedData_v4
  }
}

export { uniV2Mapping }
