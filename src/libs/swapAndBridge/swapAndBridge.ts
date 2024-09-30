import { SocketAPIStep, SocketAPIUserTx } from '../../interfaces/swapAndBridge'

const getQuoteRouteSteps = (userTxs: SocketAPIUserTx[]) => {
  return userTxs.reduce((stepsAcc: SocketAPIStep[], tx) => {
    if (tx.userTxType === 'fund-movr') {
      tx.steps.forEach((s) => stepsAcc.push(s))
    }
    if (tx.userTxType === 'dex-swap') {
      stepsAcc.push({
        chainId: tx.chainId,
        fromAmount: tx.fromAmount,
        fromAsset: tx.fromAsset,
        gasFees: tx.gasFees,
        minAmountOut: tx.minAmountOut,
        protocol: tx.protocol,
        swapSlippage: tx.swapSlippage,
        toAmount: tx.toAmount,
        toAsset: tx.toAsset,
        type: 'swap'
      })
    }
    return stepsAcc
  }, [])
}

export { getQuoteRouteSteps }
