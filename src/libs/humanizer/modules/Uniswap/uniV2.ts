import { ethers } from 'ethers'
import { getAction, getLable, getToken, getRecipientText, getDeadlineText } from '../../utils'

import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'

const uniV2Mapping = (humanizerInfo: any) => {
  const iface = new ethers.Interface(humanizerInfo?.['abis:UniV2Router'])

  return {
    // ordered in the same order as the router
    [`${iface.getFunction('swapExactTokensForTokens')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amountIn, amountOutMin, path, to, deadline] = iface.parseTransaction(call)?.args || []
      const outputAsset = path[path.length - 1]
      return [
        getAction('Swap'),
        getToken(path[0], amountIn),
        getLable('for at least'),
        getToken(outputAsset, amountOutMin),
        ...getRecipientText(accountOp.accountAddr, to),
        getDeadlineText(Number(deadline))
      ]
    },
    [`${iface.getFunction('swapTokensForExactTokens')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amountOut, amountInMax, path, to, deadline] = iface.parseTransaction(call)?.args || []
      const outputAsset = path[path.length - 1]
      return [
        getAction('Swap'),
        getLable('up to'),
        getToken(path[0], amountInMax),
        getLable('for at least'),
        getToken(outputAsset, amountOut),
        ...getRecipientText(accountOp.accountAddr, to),
        getDeadlineText(Number(deadline))
      ]
    },
    [`${iface.getFunction('swapExactETHForTokens')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const { args, value } = iface.parseTransaction(call) || { value: BigInt(0) }
      const [amountOutMin, path, to, deadline] = args || []
      const outputAsset = path[path.length - 1]
      return [
        getAction('Swap'),
        getToken(ethers.ZeroAddress, value),
        getLable('for at least'),
        getToken(outputAsset, amountOutMin),
        ...getRecipientText(accountOp.accountAddr, to),
        getDeadlineText(Number(deadline))
      ]
    },
    [`${iface.getFunction('swapTokensForExactETH')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amountOut, amountInMax, path, to, deadline] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Swap'),
        getLable('up to'),
        getToken(path[0], amountInMax),
        getLable('for at least'),
        getToken(ethers.ZeroAddress, amountOut),
        ...getRecipientText(accountOp.accountAddr, to),
        getDeadlineText(Number(deadline))
      ]
    },
    [`${iface.getFunction('swapExactTokensForETH')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amountIn, amountOutMin, path, to, deadline] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Swap'),
        getToken(path[0], amountIn),
        getLable('for at least'),
        getToken(ethers.ZeroAddress, amountOutMin),
        ...getRecipientText(accountOp.accountAddr, to),
        getDeadlineText(Number(deadline))
      ]
    },
    [`${iface.getFunction('swapETHForExactTokens')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const { args, value } = iface.parseTransaction(call) || { value: BigInt(0) }
      const [amountOut, path, to, deadline] = args || []
      const outputAsset = path[path.length - 1]
      return [
        getAction('Swap'),
        getLable('up to'),
        getToken(ethers.ZeroAddress, value),
        getLable('for at least'),
        getToken(outputAsset, amountOut),
        ...getRecipientText(accountOp.accountAddr, to),
        getDeadlineText(Number(deadline))
      ]
    },
    // Liquidity
    [`${iface.getFunction('addLiquidity')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
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
        getAction('Add liquidity'),
        getToken(tokenA, amountADesired),
        getLable('and'),
        getToken(tokenB, amountBDesired),
        ...getRecipientText(accountOp.accountAddr, to),
        getDeadlineText(Number(deadline))
      ]
    },
    [`${iface.getFunction('addLiquidityETH')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const { args, value } = iface.parseTransaction(call) || { args: [], value: BigInt(0) }
      const [token, amountTokenDesired /* amountTokenMin */ /* amountETHMin */, , , to, deadline] =
        args
      return [
        getAction('Add liquidity'),
        getToken(token, amountTokenDesired),
        getLable('and'),
        getToken(ethers.ZeroAddress, value),
        ...getRecipientText(accountOp.accountAddr, to),
        getDeadlineText(deadline)
      ]
    },
    [`${iface.getFunction('removeLiquidity')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [tokenA, tokenB /* liquidity */, , amountAMin, amountBMin, to, deadline] =
        iface.parseTransaction(call)?.args || []
      return [
        getAction('Remove liquidity'),
        getLable('at least'),
        getToken(tokenA, amountAMin),
        getLable('and'),
        getToken(tokenB, amountBMin),
        ...getRecipientText(accountOp.accountAddr, to),
        getDeadlineText(deadline)
      ]
    },
    [`${iface.getFunction('removeLiquidityETH')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [token /* liquidity */, , amountTokenMin, amountETHMin, to, deadline] =
        iface.parseTransaction(call)?.args || []
      return [
        getAction('Remove liquidity'),
        getLable('at least'),
        getToken(token, amountTokenMin),
        getLable('and'),
        getToken(ethers.ZeroAddress, amountETHMin),
        ...getRecipientText(accountOp.accountAddr, to),
        getDeadlineText(deadline)
      ]
    }
    // NOTE: We currently do not support *WithPermit functions cause they require an ecrecover signature
    // Uniswap will detect we don't support it cause it will fail on requesting eth_signTypedData_v4
  }
}

export { uniV2Mapping }
