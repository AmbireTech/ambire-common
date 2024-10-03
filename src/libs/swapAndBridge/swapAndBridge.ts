import { Interface } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import {
  SocketAPISendTransactionRequest,
  SocketAPIStep,
  SocketAPIToken,
  SocketAPIUserTx,
  SocketAPIUserTxApprovalData
} from '../../interfaces/swapAndBridge'
import { SignUserRequest } from '../../interfaces/userRequest'
import { normalizeNativeTokenAddressIfNeeded } from '../../services/socket/api'
import { TokenResult } from '../portfolio'

export const sortTokenListResponse = (
  tokenListResponse: SocketAPIToken[],
  accountPortfolioTokenList: TokenResult[]
) => {
  const normalizedPortfolioTokenList = accountPortfolioTokenList.map((t) => ({
    ...t,
    address: normalizeNativeTokenAddressIfNeeded(
      // incoming token addresses from Socket (to compare against) are lowercased
      t.address.toLowerCase()
    )
  }))

  return (
    tokenListResponse
      // Alphabetically, by project name (not token symbol)
      .sort((a: SocketAPIToken, b: SocketAPIToken) => a.name?.localeCompare(b?.name))
      // Sort fist the tokens that exist in the account portfolio
      .sort((a: SocketAPIToken, b: SocketAPIToken) => {
        const aInPortfolio = normalizedPortfolioTokenList.some((t) => t.address === a.address)
        const bInPortfolio = normalizedPortfolioTokenList.some((t) => t.address === b.address)

        if (aInPortfolio && !bInPortfolio) return -1
        if (!aInPortfolio && bInPortfolio) return 1
        return 0 // retain the alphabetical order
      })
  )
}

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

const buildSwapAndBridgeApproveUserRequest = (
  approveData: SocketAPIUserTxApprovalData,
  activeRouteId: number,
  networkId: string,
  accountAddr: string
) => {
  const erc20Interface = new Interface(ERC20.abi)
  const txn = {
    kind: 'calls' as const,
    calls: [
      {
        to: approveData.approvalTokenAddress,
        value: BigInt('0'),
        data: erc20Interface.encodeFunctionData('approve', [
          approveData.allowanceTarget,
          BigInt(approveData.minimumApprovalAmount)
        ])
      }
    ]
  }

  return {
    id: `${activeRouteId}-approval`,
    action: txn,
    meta: { isSignAction: true, networkId, accountAddr, activeRouteId, isApproval: true }
  } as SignUserRequest
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
    meta: { isSignAction: true, networkId, accountAddr, activeRouteId: userTx.activeRouteId }
  } as SignUserRequest
}

export { getQuoteRouteSteps, buildSwapAndBridgeApproveUserRequest, buildSwapAndBridgeUserRequest }
