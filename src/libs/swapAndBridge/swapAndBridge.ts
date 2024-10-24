import { Interface } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { Account } from '../../interfaces/account'
import {
  ActiveRoute,
  SocketAPIBridgeUserTx,
  SocketAPISendTransactionRequest,
  SocketAPIStep,
  SocketAPIToken,
  SocketAPIUserTx
} from '../../interfaces/swapAndBridge'
import { SignUserRequest } from '../../interfaces/userRequest'
import { isSmartAccount } from '../account/account'
import { Call } from '../accountOp/types'
import { TokenResult } from '../portfolio'

export const sortTokenListResponse = (
  tokenListResponse: SocketAPIToken[],
  accountPortfolioTokenList: TokenResult[]
) => {
  return (
    tokenListResponse
      // Alphabetically, by project name (not token symbol)
      .sort((a: SocketAPIToken, b: SocketAPIToken) => a.name?.localeCompare(b?.name))
      // Sort fist the tokens that exist in the account portfolio
      .sort((a: SocketAPIToken, b: SocketAPIToken) => {
        const aInPortfolio = accountPortfolioTokenList.some((t) => t.address === a.address)
        const bInPortfolio = accountPortfolioTokenList.some((t) => t.address === b.address)

        if (aInPortfolio && !bInPortfolio) return -1
        if (!aInPortfolio && bInPortfolio) return 1
        return 0 // retain the alphabetical order
      })
  )
}

const getQuoteRouteSteps = (userTxs: SocketAPIUserTx[]) => {
  return userTxs.reduce((stepsAcc: SocketAPIStep[], tx) => {
    if (tx.userTxType === 'fund-movr') {
      tx.steps.forEach((s) => stepsAcc.push({ ...s, userTxIndex: tx.userTxIndex }))
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
        type: 'swap',
        userTxIndex: tx.userTxIndex
      })
    }
    return stepsAcc
  }, [])
}

const getActiveRoutesLowestServiceTime = (activeRoutes: ActiveRoute[]) => {
  const serviceTimes: number[] = []

  activeRoutes.forEach((r) =>
    r.route.userTxs.forEach((tx) => {
      if ((tx as SocketAPIBridgeUserTx).serviceTime) {
        serviceTimes.push((tx as SocketAPIBridgeUserTx).serviceTime)
      }
    })
  )

  return serviceTimes.sort((a, b) => a - b)[0]
}

const getActiveRoutesUpdateInterval = (minServiceTime?: number) => {
  if (!minServiceTime) return 7000

  if (minServiceTime < 60) return 5000
  if (minServiceTime <= 180) return 6000
  if (minServiceTime <= 300) return 8000
  if (minServiceTime <= 600) return 12000

  return 15000
}

const buildSwapAndBridgeUserRequests = (
  userTx: SocketAPISendTransactionRequest,
  networkId: string,
  account: Account
) => {
  if (isSmartAccount(account)) {
    const calls: Call[] = []
    if (userTx.approvalData) {
      const erc20Interface = new Interface(ERC20.abi)
      calls.push({
        to: userTx.approvalData.approvalTokenAddress,
        value: BigInt('0'),
        data: erc20Interface.encodeFunctionData('approve', [
          userTx.approvalData.allowanceTarget,
          BigInt(userTx.approvalData.minimumApprovalAmount)
        ]),
        fromUserRequestId: userTx.activeRouteId
      } as Call)
    }

    calls.push({
      to: userTx.txTarget,
      value: BigInt(userTx.value),
      data: userTx.txData,
      fromUserRequestId: userTx.activeRouteId
    } as Call)

    return [
      {
        id: userTx.activeRouteId,
        action: {
          kind: 'calls' as const,
          calls
        },
        meta: {
          isSignAction: true,
          networkId,
          accountAddr: account.addr,
          activeRouteId: userTx.activeRouteId
        }
      } as SignUserRequest
    ]
  }
  const requests: SignUserRequest[] = []
  if (userTx.approvalData) {
    const erc20Interface = new Interface(ERC20.abi)
    requests.push({
      id: `${userTx.activeRouteId}-approval`,
      action: {
        kind: 'calls' as const,
        calls: [
          {
            to: userTx.approvalData.approvalTokenAddress,
            value: BigInt('0'),
            data: erc20Interface.encodeFunctionData('approve', [
              userTx.approvalData.allowanceTarget,
              BigInt(userTx.approvalData.minimumApprovalAmount)
            ]),
            fromUserRequestId: `${userTx.activeRouteId}-approval`
          } as Call
        ]
      },
      meta: {
        isSignAction: true,
        networkId,
        accountAddr: account.addr,
        activeRouteId: userTx.activeRouteId,
        isApproval: true
      }
    } as SignUserRequest)
  }

  requests.push({
    id: userTx.activeRouteId,
    action: {
      kind: 'calls' as const,
      calls: [
        {
          to: userTx.txTarget,
          value: BigInt(userTx.value),
          data: userTx.txData,
          fromUserRequestId: userTx.activeRouteId
        } as Call
      ]
    },
    meta: {
      isSignAction: true,
      networkId,
      accountAddr: account.addr,
      activeRouteId: userTx.activeRouteId
    }
  } as SignUserRequest)

  return requests
}

export {
  getQuoteRouteSteps,
  getActiveRoutesLowestServiceTime,
  getActiveRoutesUpdateInterval,
  buildSwapAndBridgeUserRequests
}
