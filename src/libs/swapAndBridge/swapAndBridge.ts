import { Contract, getAddress, Interface, MaxUint256 } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import {
  SocketAPIUserTx,
  SwapAndBridgeActiveRoute,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeToToken
} from '../../interfaces/swapAndBridge'
import { SignUserRequest } from '../../interfaces/userRequest'
import {
  AMBIRE_WALLET_TOKEN_ON_BASE,
  AMBIRE_WALLET_TOKEN_ON_ETHEREUM
} from '../../services/socket/constants'
import { isBasicAccount } from '../account/account'
import { Call } from '../accountOp/types'
import { TokenResult } from '../portfolio'
import { getTokenBalanceInUSD } from '../portfolio/helpers'

const sortTokensByPendingAndBalance = (a: TokenResult, b: TokenResult) => {
  // Pending tokens go on top
  const isAPending =
    typeof a.amountPostSimulation === 'bigint' && a.amountPostSimulation !== BigInt(a.amount)
  const isBPending =
    typeof b.amountPostSimulation === 'bigint' && b.amountPostSimulation !== BigInt(b.amount)

  if (isAPending && !isBPending) return -1
  if (!isAPending && isBPending) return 1

  // Otherwise, higher balance comes first
  const aBalanceUSD = getTokenBalanceInUSD(a)
  const bBalanceUSD = getTokenBalanceInUSD(b)
  if (aBalanceUSD !== bBalanceUSD) return bBalanceUSD - aBalanceUSD

  return 0
}

export const sortTokenListResponse = (
  tokenListResponse: SwapAndBridgeToToken[],
  accountPortfolioTokenList: TokenResult[]
) => {
  return tokenListResponse.sort((a: SwapAndBridgeToToken, b: SwapAndBridgeToToken) => {
    const aInPortfolio = accountPortfolioTokenList.find((t) => t.address === a.address)
    const bInPortfolio = accountPortfolioTokenList.find((t) => t.address === b.address)

    // Tokens in portfolio should come first
    if (aInPortfolio && !bInPortfolio) return -1
    if (!aInPortfolio && bInPortfolio) return 1

    if (aInPortfolio && bInPortfolio) {
      const comparisonResult = sortTokensByPendingAndBalance(aInPortfolio, bInPortfolio)
      if (comparisonResult !== 0) return comparisonResult
    }

    // Otherwise, just alphabetical
    return (a.name || '').localeCompare(b.name || '')
  })
}

export const sortPortfolioTokenList = (accountPortfolioTokenList: TokenResult[]) => {
  return accountPortfolioTokenList.sort((a, b) => {
    const comparisonResult = sortTokensByPendingAndBalance(a, b)
    if (comparisonResult !== 0) return comparisonResult

    // Otherwise, just alphabetical
    return (a.symbol || '').localeCompare(b.symbol || '')
  })
}

/**
 * Determines if a token is eligible for swapping and bridging.
 * Not all tokens in the portfolio are eligible.
 */
export const getIsTokenEligibleForSwapAndBridge = (token: TokenResult) => {
  // Prevent filtering out tokens with amountPostSimulation = 0 if the actual amount is positive.
  // This ensures the token remains in the list when sending the full amount of it
  const amount =
    token.amountPostSimulation === 0n && token.amount > 0n
      ? token.amount
      : token.amountPostSimulation ?? token.amount
  const hasPositiveBalance = Number(amount) > 0
  return (
    // The same token can be in the Gas Tank (or as a Reward) and in the portfolio.
    // Exclude the one in the Gas Tank (swapping Gas Tank tokens is not supported).
    !token.flags.onGasTank &&
    // And exclude the rewards ones (swapping rewards is not supported).
    !token.flags.rewardsType &&
    hasPositiveBalance
  )
}

export const convertPortfolioTokenToSwapAndBridgeToToken = (
  portfolioToken: TokenResult,
  chainId: number
): SwapAndBridgeToToken => {
  const { address, decimals, symbol } = portfolioToken
  // Although name and symbol will be the same, it's better than having "No name" in the UI (valid use-case)
  const name = symbol
  // Fine for not having both icon props, because this would fallback to the
  // icon discovery method used for the portfolio tokens
  const icon = ''

  return { address, chainId, decimals, symbol, name, icon }
}

const getActiveRoutesLowestServiceTime = (activeRoutes: SwapAndBridgeActiveRoute[]) => {
  const serviceTimes: number[] = []

  activeRoutes.forEach((r) =>
    r.route?.userTxs.forEach((tx) => {
      if (tx.serviceTime) {
        serviceTimes.push(tx.serviceTime)
      }
    })
  )

  return serviceTimes.sort((a, b) => a - b)[0]
}

const getActiveRoutesUpdateInterval = (minServiceTime?: number) => {
  if (!minServiceTime) return 30000

  if (minServiceTime < 60) return 15000
  if (minServiceTime <= 180) return 20000
  if (minServiceTime <= 300) return 30000
  if (minServiceTime <= 600) return 60000

  return 30000
}

// If you have approval that has not been spent (in some smart contracts), the transaction may revert
const buildRevokeApprovalIfNeeded = async (
  userTx: SwapAndBridgeSendTxRequest,
  account: Account,
  state: AccountOnchainState,
  provider: RPCProvider
): Promise<Call | undefined> => {
  if (!userTx.approvalData) return
  const erc20Contract = new Contract(userTx.approvalData.approvalTokenAddress, ERC20.abi, provider)
  const requiredAmount = !isBasicAccount(account, state)
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
  userTx: SwapAndBridgeSendTxRequest,
  chainId: bigint,
  account: Account,
  provider: RPCProvider,
  state: AccountOnchainState
): Promise<SignUserRequest[]> => {
  const calls: Call[] = []
  if (userTx.approvalData) {
    const erc20Interface = new Interface(ERC20.abi)

    const revokeApproval = await buildRevokeApprovalIfNeeded(userTx, account, state, provider)
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
  })

  return [
    {
      id: userTx.activeRouteId,
      action: {
        kind: 'calls' as const,
        calls
      },
      meta: {
        isSignAction: true,
        chainId,
        accountAddr: account.addr,
        activeRouteId: userTx.activeRouteId,
        isSwapAndBridgeCall: true
      }
    }
  ]
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
  // Assume supported if missing (and receive no results when attempting to use
  // a not-supported network) than the alternative - blocking the UI.
  if (!supportedChainIds.length || !network) return true

  return supportedChainIds.includes(network.chainId)
}

const getActiveRoutesForAccount = (
  accountAddress: string,
  activeRoutes: SwapAndBridgeActiveRoute[]
) => {
  return activeRoutes.filter(
    (r) => getAddress(r.route?.sender || r.route?.userAddress || '') === accountAddress
  )
}

/**
 * Since v4.41.0 we request the shortlist from our service provider, which might
 * not include the Ambire $WALLET token. So adding it manually on the supported chains.
 */
const addCustomTokensIfNeeded = ({
  tokens,
  chainId
}: {
  tokens: SwapAndBridgeToToken[]
  chainId: number
}) => {
  const newTokens = [...tokens]

  if (chainId === 1) {
    const shouldAddAmbireWalletToken = newTokens.every(
      (t) => t.address !== AMBIRE_WALLET_TOKEN_ON_ETHEREUM.address
    )
    if (shouldAddAmbireWalletToken) newTokens.unshift(AMBIRE_WALLET_TOKEN_ON_ETHEREUM)
  }
  if (chainId === 8453) {
    const shouldAddAmbireWalletToken = newTokens.every(
      (t) => t.address !== AMBIRE_WALLET_TOKEN_ON_BASE.address
    )
    if (shouldAddAmbireWalletToken) newTokens.unshift(AMBIRE_WALLET_TOKEN_ON_BASE)
  }

  return newTokens
}

export {
  addCustomTokensIfNeeded,
  buildSwapAndBridgeUserRequests,
  getActiveRoutesForAccount,
  getActiveRoutesLowestServiceTime,
  getActiveRoutesUpdateInterval
}
