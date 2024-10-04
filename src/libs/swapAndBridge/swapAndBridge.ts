import { Interface } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { networks } from '../../consts/networks'
import {
  ActiveRoute,
  SocketAPIBridgeUserTx,
  SocketAPISendTransactionRequest,
  SocketAPIStep,
  SocketAPIToken,
  SocketAPIUserTx,
  SocketAPIUserTxApprovalData
} from '../../interfaces/swapAndBridge'
import { SignUserRequest } from '../../interfaces/userRequest'
import { formatNativeTokenAddressIfNeeded } from '../../services/address'
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

// TODO: Discuss if we should convert `TokenResult` to SocketAPIToken for the
// case when switching FROM and TO tokens is requested, but the (prev) TO token
// is missing for selected account's portfolio (TokenResult[]) tokens.
const convertSocketAPITokenToTokenResult = (tokenResult: SocketAPIToken): TokenResult => {
  const networkByChainId = networks.find((n) => Number(n.chainId) === tokenResult?.chainId)

  if (!networkByChainId) throw new Error('Matching network from the token not found.')

  return {
    address: formatNativeTokenAddressIfNeeded(tokenResult.address),
    decimals: tokenResult.decimals,
    symbol: tokenResult.symbol,
    networkId: networkByChainId.id,
    // TODO: Pull price info for these fields from the RPC or from the portfolio?
    priceIn: [],
    amount: BigInt(0),
    // TODO: Pull info for these flags from the relayer?
    flags: {
      onGasTank: false,
      rewardsType: null,
      canTopUpGasTank: false,
      isFeeToken: false
    }
  }
}

export {
  getQuoteRouteSteps,
  getActiveRoutesLowestServiceTime,
  getActiveRoutesUpdateInterval,
  buildSwapAndBridgeApproveUserRequest,
  buildSwapAndBridgeUserRequest,
  convertSocketAPITokenToTokenResult
}
