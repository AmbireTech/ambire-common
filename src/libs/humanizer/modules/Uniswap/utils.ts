import { zeroAddress } from 'viem'

import { networks } from '../../../../consts/networks'
import { HumanizerVisualization } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getLabel,
  getRecipientText,
  RECIPIENT_LABEL
} from '../../utils'

const WRAPPED_NATIVE_TOKEN_ADDRESSES = new Set(
  networks.map((network) => network.wrappedAddr?.toLowerCase()).filter(Boolean)
)
const UNISWAP_FEE_RECIPIENT_ADDRESSES = new Set(['0x000000fee13a103a10d593b9ae06b3e05f2e7e1c'])

/** Universal Router constant: "the caller of the router" (ActionConstants.MSG_SENDER). */
export const UNIVERSAL_ROUTER_MSG_SENDER = '0x0000000000000000000000000000000000000001'
/** Universal Router constant: "the router itself" (ActionConstants.ADDRESS_THIS). */
export const UNIVERSAL_ROUTER_ADDRESS_THIS = '0x0000000000000000000000000000000000000002'

/**
 * True when a Universal Router recipient resolves to the signer or to the router itself (by
 * constant or, when `routerAddr` is passed, by its address - some routers use their own address).
 * Output sent to the router stays there until a later command moves it, and every later command
 * that moves it out is humanized on its own.
 */
export const isOwnOrRouterRecipient = (
  accAddr: string,
  recAddr: string,
  routerAddr?: string
): boolean => {
  const recipient = recAddr.toLowerCase()
  return (
    recipient === accAddr.toLowerCase() ||
    recipient === UNIVERSAL_ROUTER_MSG_SENDER ||
    recipient === UNIVERSAL_ROUTER_ADDRESS_THIS ||
    (!!routerAddr && recipient === routerAddr.toLowerCase())
  )
}

/**
 * True when the address is the one Uniswap uses to collect its interface fee.
 */
export const isUniswapFeeRecipient = (address: string): boolean =>
  UNISWAP_FEE_RECIPIENT_ADDRESSES.has(address.toLowerCase())

export function parsePath(pathBytes: any) {
  // some decodePacked fun
  // can we do this with Ethers AbiCoder? probably not
  const path = []
  // address, uint24
  for (let i = 2; i < pathBytes.length; i += 46) {
    path.push(`0x${pathBytes.substr(i, 40)}`)
  }
  return path
}

export const getUniRecipientText = (accAddr: string, recAddr: string): HumanizerVisualization[] =>
  ['0x0000000000000000000000000000000000000001', zeroAddress].includes(recAddr)
    ? []
    : getRecipientText(accAddr, recAddr)

/**
 * Recipient text for the Universal Router swap and wrap commands. It hides the signer, the
 * router itself and the "caller" constant, and shows every other address - including the zero
 * address, because the Universal Router does not treat it as a special value (tokens sent there
 * are lost).
 */
export const getUniversalRouterRecipientText = (
  accAddr: string,
  recAddr: string,
  routerAddr?: string
): HumanizerVisualization[] =>
  isOwnOrRouterRecipient(accAddr, recAddr, routerAddr) ? [] : getRecipientText(accAddr, recAddr)

export const joinWithAndLabel = (
  humanizations: HumanizerVisualization[][]
): HumanizerVisualization[] =>
  humanizations
    .filter((h) => h.length)
    .reduce((acc, arr) => [...acc, ...arr, getLabel('and')], [])
    .slice(0, -1)

const isSwap = (
  call: HumanizerVisualization[] | undefined
): call is [
  HumanizerVisualization,
  HumanizerVisualization,
  HumanizerVisualization,
  HumanizerVisualization
] =>
  !!call &&
  call.length >= 4 &&
  !!call[1]?.type &&
  !!call[3]?.type &&
  !!call[0]?.content &&
  call[0].content.includes('Swap') &&
  call[1].type === 'token' &&
  call[3].type === 'token'

const isTake = (
  call: HumanizerVisualization[] | undefined
): call is [HumanizerVisualization, HumanizerVisualization] =>
  !!call &&
  call.length === 2 &&
  !!call[0] &&
  !!call[1] &&
  !!call[0].content &&
  call[0].content.includes('Take') &&
  call[1].type === 'token'

const isWrap = (
  call: HumanizerVisualization[] | undefined
): call is [HumanizerVisualization, HumanizerVisualization] =>
  !!call &&
  call.length >= 2 &&
  !!call[0]?.content &&
  !!call[1]?.type &&
  call[0].content.includes('Wrap') &&
  call[1].type === 'token'

const isUnwrap = (
  call: HumanizerVisualization[] | undefined
): call is [HumanizerVisualization, HumanizerVisualization] =>
  !!call &&
  call.length >= 2 &&
  !!call[0]?.content &&
  !!call[1]?.type &&
  call[0].content.includes('Unwrap') &&
  call[1].type === 'token'

const isSend = (
  call: HumanizerVisualization[] | undefined
): call is [HumanizerVisualization, HumanizerVisualization] =>
  !!call &&
  call.length >= 2 &&
  !!call[0]?.content &&
  !!call[1]?.type &&
  call[0].content?.includes('Send') &&
  call[1].type === 'token'

const getDeadlineValue = (call: HumanizerVisualization[]) => {
  const deadline = call.find((item) => item.type === 'deadline')
  return deadline?.value
}

const getSendRecipient = (call: HumanizerVisualization[]) => {
  const recipient = call.find((item) => item.type === 'address')
  return recipient?.address?.toLowerCase()
}

const getAddressesOfCall = (call: HumanizerVisualization[]): string[] =>
  call.flatMap((item) =>
    item.type === 'address' && item.address ? [item.address.toLowerCase()] : []
  )

/**
 * Calls that carry an address (a recipient, a spender...) must never be merged into another call
 * as if they were plain amounts, because the merge would drop the address from what the user sees.
 */
const hasAddress = (call: HumanizerVisualization[]): boolean => getAddressesOfCall(call).length > 0

const haveSameAddresses = (callA: HumanizerVisualization[], callB: HumanizerVisualization[]) => {
  const addressesA = getAddressesOfCall(callA).sort()
  const addressesB = getAddressesOfCall(callB).sort()
  return (
    addressesA.length === addressesB.length &&
    addressesA.every((address, index) => address === addressesB[index])
  )
}

/**
 * True when the call has no address, or only addresses that mean "the router holds the funds for
 * now" - so whatever happens to the funds next is described by another call.
 */
const hasOnlyRouterHeldAddresses = (call: HumanizerVisualization[]): boolean =>
  getAddressesOfCall(call).every(
    (address) =>
      address === UNIVERSAL_ROUTER_MSG_SENDER || address === UNIVERSAL_ROUTER_ADDRESS_THIS
  )

const isRecipientLabel = (item: HumanizerVisualization | undefined): boolean =>
  !!item && item.type === 'label' && item.content === RECIPIENT_LABEL

/** Splits a call into its "and send it to <address>" items and the rest of its items. */
const splitRecipient = (call: HumanizerVisualization[]) => {
  const recipient: HumanizerVisualization[] = []
  const rest: HumanizerVisualization[] = []
  for (let i = 0; i < call.length; i++) {
    const item = call[i]!
    const next = call[i + 1]
    if (isRecipientLabel(item) && next?.type === 'address') {
      recipient.push(item, next)
      i++
    } else rest.push(item)
  }
  return { recipient, rest }
}

/**
 * Replaces the recipient of `target` with the recipient of `source`, in place. Used when `target`
 * absorbs `source` (the funds that `target` produces are consumed by `source`), so the merged
 * call must say where the funds of `source` end up.
 */
const takeRecipientFrom = (target: HumanizerVisualization[], source: HumanizerVisualization[]) => {
  const { rest } = splitRecipient(target)
  const { recipient } = splitRecipient(source)
  // The first 4 items are the swap itself: action, token in, "for", token out
  target.splice(0, target.length, ...rest.slice(0, 4), ...recipient, ...rest.slice(4))
}

/**
 * A "Send" that is only the bookkeeping of a swap (for example paying a pool), as opposed to a
 * transfer to an address, which the user must always see. The only transfer to an address that is
 * safe to hide is the fee that Uniswap itself collects.
 */
const isSendWithoutRecipient = (call: HumanizerVisualization[]): boolean =>
  !hasAddress(call) || isUniswapFeeRecipient(getSendRecipient(call) || '')

type SwapEdge = {
  call: HumanizerVisualization[]
  // the tokens, with the wrapped native token counted as the native token when it is wrapped in
  // the same list of calls
  tokenIn: string
  tokenOut: string
  isWrappedIn: boolean
  recipient: HumanizerVisualization[]
  deadline: HumanizerVisualization[]
}

const sumValues = (items: (HumanizerVisualization | undefined)[]): bigint =>
  items.reduce<bigint>((sum, item) => sum + BigInt(item?.value ?? 0n), 0n)

/**
 * Merges the swaps of a route that is split in many parts into one swap.
 *
 * The swaps are read as a flow of tokens. When a group of swaps has one token that is only paid, one
 * token that is only received and other tokens that are only passed on, the whole group is one swap
 * from the first token to the last one. For example ETH -> USDC, WETH -> USDC, WETH -> USDT and
 * USDC -> USDT are one swap from ETH to USDT. Merging the swaps two by two cannot do this, because
 * the result depends on which two swaps are found first.
 *
 * A group is not merged when it could hide something: the swaps that pass a token on must not send
 * it to an address, the swaps that give the last token must send it to the same address, and no
 * other call may use a token that is passed on.
 *
 * Returns the new list of calls, or `null` when there is nothing to merge.
 */
const mergeSplitRoutes = (calls: HumanizerVisualization[][]): HumanizerVisualization[][] | null => {
  // A wrap makes the wrapped native token the same as the native token for the swaps that follow
  const wrapIndex = calls.findIndex((call) => isWrap(call) && !hasAddress(call))
  const toTokenInGroup = (address: string) =>
    wrapIndex !== -1 && WRAPPED_NATIVE_TOKEN_ADDRESSES.has(address) ? zeroAddress : address

  const edges: SwapEdge[] = []
  calls.forEach((call) => {
    if (!isSwap(call)) return
    const { recipient, rest } = splitRecipient(call.slice(4))
    // a swap with something else after it (for example "and Send ...") is not a plain swap
    if (rest.some((item) => item.type !== 'deadline')) return

    const tokenIn = call[1].address?.toLowerCase() ?? ''
    const tokenOut = call[3].address?.toLowerCase() ?? ''
    edges.push({
      call,
      tokenIn: toTokenInGroup(tokenIn),
      tokenOut: toTokenInGroup(tokenOut),
      isWrappedIn: toTokenInGroup(tokenIn) !== tokenIn,
      recipient,
      deadline: rest
    })
  })

  // the swaps that are connected by a token are one group
  const parents = new Map<string, string>()
  const findRoot = (token: string): string => {
    const parent = parents.get(token)
    if (parent === undefined || parent === token) return token
    const root = findRoot(parent)
    parents.set(token, root)
    return root
  }
  edges.forEach(({ tokenIn, tokenOut }) => parents.set(findRoot(tokenIn), findRoot(tokenOut)))

  const groups = new Map<string, SwapEdge[]>()
  edges.forEach((edge) => {
    const root = findRoot(edge.tokenIn)
    groups.set(root, [...(groups.get(root) || []), edge])
  })

  for (const group of groups.values()) {
    if (group.length < 2) continue

    const paid = new Set(group.map(({ tokenIn }) => tokenIn))
    const received = new Set(group.map(({ tokenOut }) => tokenOut))
    const sources = [...paid].filter((token) => !received.has(token))
    const lastTokens = [...received].filter((token) => !paid.has(token))
    const passedOn = [...received].filter((token) => paid.has(token))
    const [source] = sources
    const [lastToken] = lastTokens
    if (sources.length !== 1 || lastTokens.length !== 1 || !passedOn.length) continue
    if (source === undefined || lastToken === undefined) continue

    const lastEdges = group.filter(({ tokenOut }) => tokenOut === lastToken)
    const passingEdges = group.filter(({ tokenOut }) => tokenOut !== lastToken)
    const [firstLastEdge] = lastEdges
    if (!firstLastEdge) continue
    if (!passingEdges.every(({ call }) => hasOnlyRouterHeldAddresses(call))) continue
    if (!lastEdges.every(({ call }) => haveSameAddresses(call, firstLastEdge.call))) continue

    const groupCalls = new Set(group.map(({ call }) => call))
    const isPassedOnTokenUsedElsewhere = calls.some(
      (call) =>
        !groupCalls.has(call) &&
        call.some(
          (item) =>
            item.type === 'token' &&
            passedOn.includes(toTokenInGroup(item.address?.toLowerCase() ?? ''))
        )
    )
    if (isPassedOnTokenUsedElsewhere) continue

    const sourceEdge = group.find(({ tokenIn }) => tokenIn === source)
    const deadline = group.flatMap((edge) => edge.deadline)[0]
    if (!sourceEdge) continue

    const mergedSwap: HumanizerVisualization[] = [
      firstLastEdge.call[0]!,
      {
        ...sourceEdge.call[1]!,
        address: source,
        value: sumValues(group.filter(({ tokenIn }) => tokenIn === source).map((e) => e.call[1]))
      },
      firstLastEdge.call[2]!,
      { ...firstLastEdge.call[3]!, value: sumValues(lastEdges.map((e) => e.call[3])) },
      ...firstLastEdge.recipient,
      ...(deadline ? [deadline] : [])
    ]

    // the wrap is the payment of the swaps that were paid with the wrapped native token
    const isWrapUsed = source === zeroAddress && group.some(({ isWrappedIn }) => isWrappedIn)
    const firstGroupCall = calls.find((call) => groupCalls.has(call))
    return calls.flatMap((call, index) => {
      if (call === firstGroupCall) return [mergedSwap]
      if (groupCalls.has(call) || (isWrapUsed && index === wrapIndex)) return []
      return [call]
    })
  }

  return null
}

// Every time a call is merged into another or removed, the reduction starts again from a clean
// state. Continuing the same pass would keep using calls that are no longer in the list, which
// removed an unrelated call (for example a transfer to another address) with the stale one.
const reduceCalls = (_calls: HumanizerVisualization[][]): HumanizerVisualization[] => {
  const calls = _calls
  const withMergedRoutes = mergeSplitRoutes(calls)
  if (withMergedRoutes) return reduceCalls(withMergedRoutes)

  for (let i = 0; i < calls.length; i++) {
    for (let j = 0; j < calls.length; j++) {
      // looks for wraps before the swap
      const callI = calls[i]
      const callJ = calls[j]
      if (
        j < i &&
        callI &&
        callJ &&
        isSwap(callI) &&
        isWrap(callJ) &&
        !hasAddress(callJ) &&
        WRAPPED_NATIVE_TOKEN_ADDRESSES.has(callI[1].address?.toLowerCase()) &&
        (callJ[1].value === callI[1].value || callI[1].value === 0n)
      ) {
        callI[1].address = zeroAddress
        calls.splice(j, 1)
        return reduceCalls(calls)
      }
      // looks for unwrap after the swap
      if (
        i < j &&
        callI &&
        callJ &&
        isSwap(callI) &&
        isUnwrap(callJ) &&
        !hasAddress(callJ) &&
        (callJ[1].value === callI[3].value || callI[3].value === 0n)
      ) {
        callI[3].address = zeroAddress
        if (callI[3].value === 0n && callJ[1].value) callI[3].value = callJ[1].value
        calls.splice(j, 1)
        return reduceCalls(calls)
      }

      // looks for swaps to merge
      if (
        i !== j &&
        callI &&
        callJ &&
        isSwap(callI) &&
        isSwap(callJ) &&
        callI[1].address === callJ[1].address &&
        callI[3].address === callJ[3].address &&
        haveSameAddresses(callI, callJ)
      ) {
        callI[1].value = callI[1].value! + callJ[1].value!
        callI[3].value = callI[3].value! + callJ[3].value!
        calls.splice(j, 1)
        return reduceCalls(calls)
      }
      // looks for swaps to merge
      if (
        i !== j &&
        callI &&
        callJ &&
        isSwap(callI) &&
        isSwap(callJ) &&
        callI[3].address === callJ[3].address &&
        getDeadlineValue(callI) === getDeadlineValue(callJ) &&
        haveSameAddresses(callI, callJ) &&
        ((callI[1].address === zeroAddress &&
          WRAPPED_NATIVE_TOKEN_ADDRESSES.has(callJ[1].address?.toLowerCase())) ||
          (callJ[1].address === zeroAddress &&
            WRAPPED_NATIVE_TOKEN_ADDRESSES.has(callI[1].address?.toLowerCase())))
      ) {
        if (callI[1].address !== zeroAddress) {
          callI[1].address = zeroAddress
        }
        calls.splice(j, 1)
        return reduceCalls(calls)
      }
      // looks for swaps to merge
      if (
        i !== j &&
        callI &&
        callJ &&
        isSwap(callI) &&
        isSwap(callJ) &&
        callI[3].address === callJ[1].address &&
        hasOnlyRouterHeldAddresses(callI)
      ) {
        callI[3].value = callJ[3].value!
        callI[3].address = callJ[3].address
        // the merged swap ends where the second swap ends
        takeRecipientFrom(callI, callJ)

        calls.splice(j, 1)
        return reduceCalls(calls)
      }

      // looks for fee payment to subtract
      if (
        i !== j &&
        callI &&
        callJ &&
        isSend(callJ) &&
        isSwap(callI) &&
        callJ[1].address === callI[3].address &&
        UNISWAP_FEE_RECIPIENT_ADDRESSES.has(getSendRecipient(callJ) || '')
      ) {
        calls.splice(j, 1)
        return reduceCalls(calls)
      }

      if (callI && isSend(callI) && callI[1].value === 0n && isSendWithoutRecipient(callI)) {
        calls.splice(i, 1)
        return reduceCalls(calls)
      }

      if (
        i !== j &&
        callI &&
        callJ &&
        isSend(callI) &&
        isSwap(callJ) &&
        isSendWithoutRecipient(callI) &&
        callI[1].address === callJ[1].address
      ) {
        calls.splice(i, 1)
        return reduceCalls(calls)
      }

      // looks for take (sweep) action to infer the swap minimum by
      if (
        i !== j &&
        callI &&
        callJ &&
        isSwap(callI) &&
        isTake(callJ) &&
        callI[3].address === callJ[1].address
      ) {
        calls.splice(j, 1)
        return reduceCalls(calls)
      }
      if (
        i !== j &&
        callI &&
        callJ &&
        isUnwrap(callI) &&
        isTake(callJ) &&
        callI[1].address === callJ[1].address
      ) {
        if (callI[1].value && callI[1].value > 0n) {
          callI[1].value = callI[1].value > callJ[1].value! ? callI[1].value : callJ[1].value
        }
        calls.splice(j, 1)
        return reduceCalls(calls)
      }
      // because of this https://www.codeslaw.app/contracts/ethereum/0x66a9893cc07d91d95644aedd05d03f95e1dba8af?file=src%2Fpkgs%2Funiversal-router%2Flib%2Fv4-periphery%2Fsrc%2Flibraries%2FActionConstants.sol&start=11&end=13
      // we can mash two swaps into one
      if (calls.filter(isSwap).length === 2) {
        const indexesOfSwaps = calls
          .map((call, index: number) => (isSwap(call) ? index : -1))
          .filter((index: number) => index !== -1)
        const indexOfFirstCall = indexesOfSwaps[0]
        const indexOfSecondCall = indexesOfSwaps[1]
        if (typeof indexOfFirstCall === 'number' && typeof indexOfSecondCall === 'number') {
          const firstCall = calls[indexOfFirstCall]
          const secondCall = calls[indexOfSecondCall]
          if (
            firstCall &&
            secondCall &&
            firstCall[3] &&
            secondCall[1] &&
            secondCall[3] &&
            hasOnlyRouterHeldAddresses(firstCall) &&
            firstCall[3].value === 0n &&
            secondCall[1].value === BigInt(`0x8${'0'.repeat(63)}`) &&
            firstCall[3].address === secondCall[1].address
          ) {
            firstCall[3] = secondCall[3]
            takeRecipientFrom(firstCall, secondCall)
            calls.splice(indexOfSecondCall, 1)
            return reduceCalls(calls)
          }
        }
      }
    }
  }
  return joinWithAndLabel(calls)
}

/**
 * Merges the humanized Uniswap calls into the shortest description that is still accurate.
 * The merging must never hide where funds are sent, so an address that was part of a call before
 * the merge and that is not part of the result is added back at the end.
 */
export const uniReduce = (calls: HumanizerVisualization[][]): HumanizerVisualization[] => {
  // the calls are changed in place by the reduction, so what has to stay visible is read first
  const addressesToKeep = new Set(
    calls
      .flatMap(getAddressesOfCall)
      .filter(
        (address) =>
          address !== UNIVERSAL_ROUTER_MSG_SENDER &&
          address !== UNIVERSAL_ROUTER_ADDRESS_THIS &&
          !isUniswapFeeRecipient(address)
      )
  )
  const reduced = reduceCalls(calls)
  const visibleAddresses = new Set(getAddressesOfCall(reduced))
  const lostAddresses = [...addressesToKeep].filter((address) => !visibleAddresses.has(address))
  if (!lostAddresses.length) return reduced

  return joinWithAndLabel([
    reduced,
    ...lostAddresses.map((address) => [
      getAction('Send'),
      getLabel('funds to'),
      getAddressVisualization(address)
    ])
  ])
}
