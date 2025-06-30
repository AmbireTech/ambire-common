import { Contract, getAddress, Interface, MaxUint256, ZeroAddress } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { Session } from '../../classes/session'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import {
  SocketAPIUserTx,
  SwapAndBridgeActiveRoute,
  SwapAndBridgeRoute,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeToToken
} from '../../interfaces/swapAndBridge'
import { UserRequest } from '../../interfaces/userRequest'
import {
  AMBIRE_WALLET_TOKEN_ON_BASE,
  AMBIRE_WALLET_TOKEN_ON_ETHEREUM
} from '../../services/socket/constants'
import { isBasicAccount } from '../account/account'
import { Call } from '../accountOp/types'
import { PaymasterService } from '../erc7677/types'
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

export const attemptToSortTokensByMarketCap = async ({
  fetch,
  chainId,
  tokens
}: {
  fetch: Fetch
  chainId: number
  tokens: SwapAndBridgeToToken[]
}) => {
  try {
    const tokenAddressesByMarketCapRes = await fetch(
      `https://cena.ambire.com/api/v3/lists/byMarketCap/${chainId}`
    )

    if (tokenAddressesByMarketCapRes.status !== 200)
      throw new Error(`Got status ${tokenAddressesByMarketCapRes.status} from the API.`)

    const tokenAddressesByMarketCap = await tokenAddressesByMarketCapRes.json()

    // Highest market cap comes first from the response
    const addressPriority = new Map(
      tokenAddressesByMarketCap.data.map((addr: string, index: number) => [addr, index])
    )

    // Sort the result by the market cap response order position (highest first)
    return tokens.sort((a, b) => {
      const aPriority = addressPriority.get(a.address)
      const bPriority = addressPriority.get(b.address)

      if (aPriority !== undefined && bPriority !== undefined)
        return (aPriority as number) - (bPriority as number)

      if (aPriority !== undefined) return -1
      if (bPriority !== undefined) return 1
      return 0
    })
  } catch (e) {
    // Fail silently, no biggie
    console.error(`Sorting Swap & Bridge tokens by market for network with id ${chainId} failed`, e)
    return tokens
  }
}

export const sortNativeTokenFirst = (tokens: SwapAndBridgeToToken[]) => {
  return tokens.sort((a, b) => {
    if (a.address === ZeroAddress) return -1
    if (b.address === ZeroAddress) return 1
    return 0
  })
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

    // Otherwise, don't change, persist the order from the service provider
    return 0
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

  // the absolute minimum needs to be 30s, it's not a game changer
  // if the user waits an additional 15s to get a status check
  // but it's a game changer if we brick the API with a 429
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

const getSwapAndBridgeCalls = async (
  userTx: SwapAndBridgeSendTxRequest,
  account: Account,
  provider: RPCProvider,
  state: AccountOnchainState
): Promise<Call[]> => {
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

  return calls
}

const buildSwapAndBridgeUserRequests = async (
  userTx: SwapAndBridgeSendTxRequest,
  chainId: bigint,
  account: Account,
  provider: RPCProvider,
  state: AccountOnchainState,
  paymasterService?: PaymasterService,
  windowId?: number
): Promise<UserRequest[]> => {
  return [
    {
      id: userTx.activeRouteId,
      action: {
        kind: 'calls' as const,
        calls: await getSwapAndBridgeCalls(userTx, account, provider, state)
      },
      session: new Session({ windowId }),
      meta: {
        isSignAction: true as true,
        chainId,
        accountAddr: account.addr,
        activeRouteId: userTx.activeRouteId,
        isSwapAndBridgeCall: true,
        paymasterService
      }
    }
  ]
}

export const getIsBridgeTxn = (userTxType: SocketAPIUserTx['userTxType']) =>
  userTxType === 'fund-movr'

export const getIsBridgeRoute = (route: SwapAndBridgeRoute) => {
  return route.userTxs.some((userTx) => getIsBridgeTxn(userTx.userTxType))
}

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

// the celo native token is at an address 0x471EcE3750Da237f93B8E339c536989b8978a438
// and LiFi doesn't work if we pass address 0 for this. We map it only for
// lifi to make the swap work in this case
const lifiMapNativeToAddr = (chainId: number, tokenAddr: string) => {
  if (tokenAddr !== ZeroAddress) return tokenAddr
  // celo chain
  if (chainId !== 42220) return tokenAddr

  return '0x471EcE3750Da237f93B8E339c536989b8978a438'
}

const lifiTokenListFilter = (t: SwapAndBridgeToToken) => {
  // disabled tokens, this one is CELO as an addr on CELO chain (exists as native)
  return !(t.chainId === 42220 && t.address === '0x471EcE3750Da237f93B8E339c536989b8978a438')
}

/**
 * Map the token address back to native when needed
 */
const mapNativeToAddr = (
  serviceProviderId: 'lifi' | 'socket',
  chainId: number,
  tokenAddr: string
) => {
  if (serviceProviderId === 'socket') return tokenAddr

  if (chainId !== 42220) return tokenAddr

  if (tokenAddr !== '0x471EcE3750Da237f93B8E339c536989b8978a438') return tokenAddr

  return ZeroAddress
}

export {
  addCustomTokensIfNeeded,
  buildSwapAndBridgeUserRequests,
  getActiveRoutesForAccount,
  getActiveRoutesLowestServiceTime,
  getActiveRoutesUpdateInterval,
  getSwapAndBridgeCalls,
  lifiMapNativeToAddr,
  lifiTokenListFilter,
  mapNativeToAddr
}
