import { zeroAddress } from 'viem'

import { SwapAndBridgeActiveRoute, SwapAndBridgeRoute } from '../../interfaces/swapAndBridge'
import { TokenResult } from '../portfolio/interfaces'
import convertNullAddressToZeroAddressIfNeeded from '../../utils/convertNullAddressToZeroAddressIfNeeded'
import { getIsIntentRoute } from './swapAndBridge'

/** What in-progress swaps and bridges will still move of a token */
export type PendingDelivery = {
  /** The amount that will move in (positive) or out (negative) of the account */
  amount: bigint
  /** The active routes that will move it, e.g. to show them when the user opens the token */
  activeRouteIds: SwapAndBridgeActiveRoute['activeRouteId'][]
}

/**
 * The tokens that in-progress swaps and bridges will still move in or out of an account
 * after its transaction was mined, keyed by `getPendingDeliveryKey`.
 */
export type PendingDeliveries = { [tokenKey: string]: PendingDelivery }

const normalizeTokenAddress = (address: string) =>
  convertNullAddressToZeroAddressIfNeeded(address).toLowerCase()

/**
 * The key of a token in `PendingDeliveries`. Addresses are compared case-insensitively and
 * both conventions for the native token are treated as the same token.
 */
export const getPendingDeliveryKey = (chainId: bigint | number, address: string) =>
  `${chainId.toString()}:${normalizeTokenAddress(address)}`

/**
 * The amounts are the ones the route's card shows (`RouteStepsPreview`), so the dashboard
 * and the swap or bridge banner always show the same numbers: the amount sent by the first
 * step and the amount received by the last one, falling back to the route's totals.
 */
const getSentAmount = (route: SwapAndBridgeRoute) =>
  BigInt(route.steps?.[0]?.fromAmount ?? route.fromAmount)

const getReceivedAmount = (route: SwapAndBridgeRoute) =>
  BigInt(route.steps?.[route.steps.length - 1]?.toAmount ?? route.toAmount)

/**
 * Whether the sent tokens leave the account only when the route is finalized, instead of with
 * the user's transaction. That's the case for CoW Swap orders that sell an ERC-20 token: the
 * transaction only pre-signs the order and the tokens are taken when the order is filled.
 * Native token sells go through the ETH-flow contract, which takes the tokens with the transaction.
 */
const getIsSentAmountPending = (activeRoute: SwapAndBridgeActiveRoute, route: SwapAndBridgeRoute) =>
  route.providerId === 'cowswap' &&
  normalizeTokenAddress(activeRoute.fromAssetAddress) !== zeroAddress

/**
 * Calculates the token amounts that the in-progress swaps and bridges of an account will still
 * move after the account's transaction was mined. They finish asynchronously (e.g. a bridge
 * delivers the tokens on the other network, a CoW Swap order waits to be filled), so the
 * portfolio can't see these amounts yet:
 * - the received tokens are always pending, as they arrive when the route is finalized
 * - the sent tokens are pending only for CoW Swap ERC-20 sells (see `getIsSentAmountPending`).
 *   Otherwise, they leave the account with the transaction, which the portfolio already reflects
 *
 * Regular swaps aren't included, because they finish with the user's transaction.
 */
export const getPendingDeliveries = (
  activeRoutes: SwapAndBridgeActiveRoute[],
  accountAddr: string
): PendingDeliveries => {
  const pendingDeliveries: PendingDeliveries = {}
  const lowercasedAccountAddr = accountAddr.toLowerCase()
  const addToPendingDeliveries = (
    tokenKey: string,
    amount: bigint,
    activeRouteId: SwapAndBridgeActiveRoute['activeRouteId']
  ) => {
    const pendingDelivery = pendingDeliveries[tokenKey]
    pendingDeliveries[tokenKey] = {
      amount: (pendingDelivery?.amount || 0n) + amount,
      activeRouteIds: [...(pendingDelivery?.activeRouteIds || []), activeRouteId]
    }
  }

  activeRoutes.forEach((activeRoute) => {
    const { route } = activeRoute
    if (!route || activeRoute.routeStatus !== 'in-progress') return
    if (activeRoute.sender.toLowerCase() !== lowercasedAccountAddr) return
    if (!getIsIntentRoute(route)) return

    addToPendingDeliveries(
      getPendingDeliveryKey(route.toChainId, activeRoute.toAssetAddress),
      getReceivedAmount(route),
      activeRoute.activeRouteId
    )

    if (!getIsSentAmountPending(activeRoute, route)) return

    addToPendingDeliveries(
      getPendingDeliveryKey(route.fromChainId, activeRoute.fromAssetAddress),
      -getSentAmount(route),
      activeRoute.activeRouteId
    )
  })

  return pendingDeliveries
}

/**
 * Whether the token is held by the account itself, as swaps and bridges deliver there. The
 * Gas Tank and rewards copies of a token share its network and address, so they'd otherwise
 * be mistaken for it.
 */
const getIsAccountHeldToken = (token: Pick<TokenResult, 'flags'>) =>
  !token.flags.onGasTank && !token.flags.rewardsType

/**
 * A string that changes only when the pending deliveries change, to skip work when an
 * update of the active routes doesn't change what is on its way (e.g. a status poll).
 */
export const getPendingDeliveriesSignature = (pendingDeliveries: PendingDeliveries): string =>
  Object.entries(pendingDeliveries)
    .map(([tokenKey, { amount }]) => `${tokenKey}=${amount.toString()}`)
    .sort()
    .join(',')

/**
 * Sets `pendingDeliveryAmount` on the tokens that are on their way. Returns the same tokens
 * when nothing is, and copies only the tokens it changes. The Gas Tank and rewards copies of
 * a token are skipped (see `getIsAccountHeldToken`).
 */
export const addPendingDeliveryAmounts = <
  T extends Pick<TokenResult, 'chainId' | 'address' | 'flags' | 'pendingDeliveryAmount'>
>(
  tokens: T[],
  pendingDeliveries: PendingDeliveries
): T[] => {
  if (!Object.keys(pendingDeliveries).length) return tokens

  return tokens.map((token) => {
    if (!getIsAccountHeldToken(token)) return token

    const pendingDelivery = pendingDeliveries[getPendingDeliveryKey(token.chainId, token.address)]
    if (!pendingDelivery?.amount) return token

    return { ...token, pendingDeliveryAmount: pendingDelivery.amount }
  })
}
