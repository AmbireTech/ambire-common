import { Contract, getAddress, Interface, MaxUint256 } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { Account } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
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

export const convertPortfolioTokenToSocketAPIToken = (
  portfolioToken: TokenResult,
  chainId: number
): SocketAPIToken => {
  const { address, decimals, symbol } = portfolioToken
  // Although name and symbol will be the same, it's better than having "No name" in the UI (valid use-case)
  const name = symbol
  // Fine for not having both icon props, because this would fallback to the
  // icon discovery method used for the portfolio tokens
  const icon = ''
  const logoURI = ''

  return { address, chainId, decimals, symbol, name, icon, logoURI }
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

const buildRevokeApprovalIfNeeded = async (
  userTx: SocketAPISendTransactionRequest,
  account: Account,
  provider: RPCProvider
): Promise<Call | undefined> => {
  if (!userTx.approvalData) return
  const erc20Contract = new Contract(userTx.approvalData.approvalTokenAddress, ERC20.abi, provider)
  const requiredAmount = isSmartAccount(account)
    ? BigInt(userTx.approvalData.minimumApprovalAmount)
    : MaxUint256
  const approveCallData = erc20Contract.interface.encodeFunctionData('approve', [
    userTx.approvalData.allowanceTarget,
    requiredAmount
  ])

  let fails = false
  try {
    await provider.call({
      from: account.addr,
      to: userTx.approvalData.approvalTokenAddress,
      data: approveCallData
    })
  } catch (e) {
    fails = true
  }

  if (!fails) return

  return {
    to: userTx.approvalData.approvalTokenAddress,
    value: BigInt('0'),
    data: erc20Contract.interface.encodeFunctionData('approve', [
      userTx.approvalData.allowanceTarget,
      BigInt(0)
    ])
  }
}

const buildSwapAndBridgeUserRequests = async (
  userTx: SocketAPISendTransactionRequest,
  networkId: string,
  account: Account,
  provider: RPCProvider
) => {
  if (isSmartAccount(account)) {
    const calls: Call[] = []
    if (userTx.approvalData) {
      const erc20Interface = new Interface(ERC20.abi)

      const revokeApproval = await buildRevokeApprovalIfNeeded(userTx, account, provider)
      if (revokeApproval) calls.push(revokeApproval)

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
    let shouldApprove = true
    try {
      const erc20Contract = new Contract(
        userTx.approvalData.approvalTokenAddress,
        ERC20.abi,
        provider
      )
      const allowance = await erc20Contract.allowance(
        userTx.approvalData.owner,
        userTx.approvalData.allowanceTarget
      )
      // check if an approval already exists
      if (BigInt(allowance) >= BigInt(userTx.approvalData.minimumApprovalAmount))
        shouldApprove = false
    } catch (error) {
      console.error(error)
    }

    if (shouldApprove) {
      const revokeApproval = await buildRevokeApprovalIfNeeded(userTx, account, provider)
      if (revokeApproval) {
        requests.push({
          id: `${userTx.activeRouteId}-revoke-approval`,
          action: { kind: 'calls' as const, calls: [revokeApproval] },
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
        id: `${userTx.activeRouteId}-approval`,
        action: {
          kind: 'calls' as const,
          calls: [
            {
              to: userTx.approvalData.approvalTokenAddress,
              value: BigInt('0'),
              data: erc20Interface.encodeFunctionData('approve', [
                userTx.approvalData.allowanceTarget,
                MaxUint256 // approve the max possible amount for better UX on BA
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

export const getIsBridgeTxn = (userTxType: SocketAPIUserTx['userTxType']) =>
  userTxType === 'fund-movr'

/**
 * Checks if a network is supported by our Swap & Bridge service provider. As of v4.43.0
 * there are 16 networks supported, so user could have (many) custom networks that are not.
 */
export const getIsNetworkSupported = (
  supportedChainIds: Network['chainId'][],
  network?: Network
) => {
  // Assume supported if missing (and receive no results) than the alternatives (blocking the UI)
  if (!supportedChainIds.length || !network) return true

  return supportedChainIds.includes(network.chainId)
}

const getActiveRoutesForAccount = (accountAddress: string, activeRoutes: ActiveRoute[]) => {
  return activeRoutes.filter(
    (r) => getAddress(r.route.sender || r.route.userAddress) === accountAddress
  )
}

export {
  getQuoteRouteSteps,
  getActiveRoutesLowestServiceTime,
  getActiveRoutesUpdateInterval,
  buildSwapAndBridgeUserRequests,
  getActiveRoutesForAccount
}
