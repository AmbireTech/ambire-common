import { ethers } from 'ethers'
import { getAction, getLabel, getToken, getRecipientText, getDeadlineText } from '../../utils'

import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'

const uniV2Mapping = (
  humanizerInfo: any
): { [key: string]: (a: AccountOp, c: IrCall) => IrCall[] } => {
  const iface = new ethers.Interface(humanizerInfo?.['abis:UniV2Router'])

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
            getDeadlineText(deadline)
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
            getDeadlineText(deadline)
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
            getToken(ethers.ZeroAddress, value),
            getLabel('for at least'),
            getToken(outputAsset, amountOutMin),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadlineText(deadline)
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
            getToken(ethers.ZeroAddress, amountOut),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadlineText(deadline)
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
            getToken(ethers.ZeroAddress, amountOutMin),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadlineText(deadline)
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
            getToken(ethers.ZeroAddress, value),
            getLabel('for at least'),
            getToken(outputAsset, amountOut),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadlineText(deadline)
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
            getDeadlineText(deadline)
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
            getToken(ethers.ZeroAddress, value),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadlineText(deadline)
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
            getDeadlineText(deadline)
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
            getToken(ethers.ZeroAddress, amountETHMin),
            ...getRecipientText(accountOp.accountAddr, to),
            getDeadlineText(deadline)
          ]
        }
      ]
    }
    // NOTE: We currently do not support *WithPermit functions cause they require an ecrecover signature
    // Uniswap will detect we don't support it cause it will fail on requesting eth_signTypedData_v4
  }
}

export { uniV2Mapping }
