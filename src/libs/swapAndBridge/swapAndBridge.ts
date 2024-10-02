import { SignUserRequest } from 'interfaces/userRequest'

import {
  SocketAPISendTransactionRequest,
  SocketAPIStep,
  SocketAPIUserTx
} from '../../interfaces/swapAndBridge'

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

const buildSwapAndBridgeUserRequest = (
  userTx: SocketAPISendTransactionRequest,
  networkId: string,
  accountAddr: string
) => {
  const txn = {
    kind: 'calls' as const,
    calls: [{ to: userTx.txTarget, value: BigInt(userTx.value), data: userTx.txData }]
  }

  return {
    id: userTx.activeRouteId,
    action: txn,
    meta: { isSignAction: true, networkId, accountAddr }
  } as SignUserRequest
}

export { getQuoteRouteSteps, buildSwapAndBridgeUserRequest }
