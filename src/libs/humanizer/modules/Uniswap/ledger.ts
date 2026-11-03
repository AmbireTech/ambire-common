import {
  Amount,
  ConvertEffect,
  ConversionKind,
  Effect,
  NATIVE_TOKEN,
  OpaqueEffect,
  PermitEffect,
  Place,
  ROUTER,
  UNKNOWN,
  USER,
  UniswapContext,
  convert,
  exact,
  getPlaceKey,
  isPassThroughPlace,
  transfer
} from './effects'

/** One movement of tokens between two places */
export type Flow = {
  /** the position of the effect that made this flow, in `Outcome.effects` */
  effectIndex: number
  token: string
  tokenOut: string
  conversion: ConversionKind | null
  fromUser: boolean
  /** the pass-through place and token that it takes from. Empty when it comes from an end place. */
  fromNode: string | null
  toNode: string | null
  /** the user or an external address, when the tokens are not passed on */
  toPlace: Place | null
  /** set when it takes a share of what the place holds */
  portionBips: bigint | null
  /** a small share to another address, that is not shown (see `MAX_HIDDEN_SHARE_BIPS`) */
  isHiddenLeak: boolean
}

export type Terminal = {
  place: Place
  token: string
  isHidden: boolean
  /**
   * Set when the tokens are only reached by taking shares of what a place holds: the largest part
   * of it that can arrive, in basis points
   */
  shareBips: bigint | null
}

/** Flows that are connected by a place that passes tokens on. They are one operation for the user. */
export type Group = {
  flows: Flow[]
  /** what the signer pays, without repeats */
  userPaid: string[]
  conversions: ConversionKind[]
  terminals: Terminal[]
  /** the places of this group that can hold some of the tokens at the end */
  holdingPlaces: { place: Place; token: string }[]
}

export type Outcome = {
  groups: Group[]
  /** the effects after the ledger resolved them. The flows refer to this list. */
  effects: Effect[]
  flows: Flow[]
  permits: PermitEffect[]
  opaque: OpaqueEffect[]
  /** pass-through places that can still hold some of the tokens of the signer at the end */
  stranded: { place: Place; token: string }[]
}

type BalanceState = { kind: 'zero' } | { kind: 'exact'; value: bigint } | { kind: 'maybe' }

const ZERO: BalanceState = { kind: 'zero' }
const MAYBE: BalanceState = { kind: 'maybe' }

const BIPS_BASE = 10000n

/**
 * Payments of this share, or less, to another address are part of the price of the swap (the fee
 * of the interface) and are not shown. The share is counted for all the payments of one token
 * together, so that many small payments cannot hide a large one.
 */
export const MAX_HIDDEN_SHARE_BIPS = 100n

const getCappedShares = (bips: bigint[]): bigint[] =>
  bips.map((share) => (share > BIPS_BASE ? BIPS_BASE : share)).filter((share) => share > 0n)

/**
 * True when what is left after all the payments is at least 99% of what there was.
 * A payment of nothing changes nothing, so it is skipped. Every other payment takes at least one
 * basis point, so what is left falls below 99% after about 100 payments and the check stops there.
 * This keeps the numbers small when a call has a very large number of payments.
 */
const isSmallTotalShare = (bips: bigint[]): boolean => {
  let kept = 1n
  let base = 1n
  return getCappedShares(bips).every((share) => {
    kept *= BIPS_BASE - share
    base *= BIPS_BASE
    return kept * BIPS_BASE >= base * (BIPS_BASE - MAX_HIDDEN_SHARE_BIPS)
  })
}

/** The largest part of what a place holds that all the shares can take together, in basis points */
const getTotalShareBips = (bips: bigint[]): bigint => {
  const shares = getCappedShares(bips)
  if (!shares.length) return 0n

  const kept = shares.reduce((product, share) => product * (BIPS_BASE - share), 1n)
  return BIPS_BASE - kept / BIPS_BASE ** BigInt(shares.length - 1)
}

const getNodeKey = (place: Place, token: string) => `${getPlaceKey(place)}|${token}`

/**
 * Follows the tokens through all the effects of a call.
 *
 * A place that passes tokens on holds whatever comes in. What goes out of it can come from any of
 * what came in, so the flows that meet in such a place are one group. This can only add possible
 * flows and never removes one, so what the user pays and who receives tokens is never hidden.
 *
 * The ledger also follows how many tokens each place holds, as far as the amounts are known, to find
 * the tokens that stay in a place at the end.
 */
export const buildOutcome = (effects: Effect[], ctx: UniswapContext): Outcome => {
  const states = new Map<string, BalanceState>()
  const resolvedEffects: Effect[] = []
  const flows: Flow[] = []
  const permits: PermitEffect[] = []
  const opaque: OpaqueEffect[] = []

  // The shares of what a place holds that are taken into a router or a pool, by place and token, and
  // the places that something other than a share goes into. A place that only gets small shares
  // (the fee of an interface) is not reported when the tokens stay.
  const shareInflows = new Map<string, bigint[]>()
  const nodesWithOtherInflows = new Set<string>()

  const getState = (nodeKey: string): BalanceState => states.get(nodeKey) ?? ZERO

  // takes tokens out of a place. Returns how many tokens come out, as far as it is known.
  const takeFrom = (place: Place, token: string, amount: Amount): Amount => {
    if (!isPassThroughPlace(place)) return amount.kind === 'exact' ? amount : UNKNOWN

    const nodeKey = getNodeKey(place, token)
    const state = getState(nodeKey)
    if (amount.kind === 'exact') {
      if (state.kind === 'exact') {
        const left = state.value - amount.value
        if (left < 0n) states.set(nodeKey, MAYBE)
        else states.set(nodeKey, left === 0n ? ZERO : { kind: 'exact', value: left })
      }
      return amount
    }
    if (amount.kind === 'all') {
      states.set(nodeKey, ZERO)
      if (state.kind === 'exact') return exact(state.value)
      return state.kind === 'zero' ? exact(0n) : UNKNOWN
    }
    if (state.kind === 'exact') states.set(nodeKey, MAYBE)
    return UNKNOWN
  }

  // puts tokens in a place
  const giveTo = (place: Place, token: string, amount: Amount, isShare = false) => {
    if (!isPassThroughPlace(place)) return

    const nodeKey = getNodeKey(place, token)
    if (!isShare) nodesWithOtherInflows.add(nodeKey)
    const state = getState(nodeKey)
    if (amount.kind !== 'exact') {
      states.set(nodeKey, MAYBE)
      return
    }
    if (amount.value === 0n) return
    if (state.kind === 'zero') states.set(nodeKey, { kind: 'exact', value: amount.value })
    if (state.kind === 'exact') {
      states.set(nodeKey, { kind: 'exact', value: state.value + amount.value })
    }
  }

  const getEnds = (from: Place, to: Place, tokenIn: string, tokenOut: string) => ({
    fromUser: from.kind === 'user',
    fromNode: isPassThroughPlace(from) ? getNodeKey(from, tokenIn) : null,
    toNode: isPassThroughPlace(to) ? getNodeKey(to, tokenOut) : null,
    toPlace: isPassThroughPlace(to) ? null : to
  })

  const apply = (effect: Effect) => {
    const effectIndex = resolvedEffects.length
    resolvedEffects.push(effect)

    if (effect.type === 'permit') permits.push(effect)
    if (effect.type === 'opaque') opaque.push(effect)

    if (effect.type === 'transfer') {
      const received = takeFrom(effect.from, effect.token, effect.amount)
      if (effect.amount.kind === 'portion' && isPassThroughPlace(effect.to)) {
        const nodeKey = getNodeKey(effect.to, effect.token)
        const shares = shareInflows.get(nodeKey)
        if (shares) shares.push(effect.amount.bips)
        else shareInflows.set(nodeKey, [effect.amount.bips])
      }
      giveTo(effect.to, effect.token, received, effect.amount.kind === 'portion')
      flows.push({
        effectIndex,
        token: effect.token,
        tokenOut: effect.token,
        conversion: null,
        ...getEnds(effect.from, effect.to, effect.token, effect.token),
        portionBips: effect.amount.kind === 'portion' ? effect.amount.bips : null,
        isHiddenLeak: false
      })
    }

    if (effect.type === 'convert') {
      const received = takeFrom(effect.from, effect.tokenIn, effect.amountIn)
      // a swap returns an amount that is not known. A wrap or an unwrap gives the same amount back.
      giveTo(effect.to, effect.tokenOut, effect.kind === 'swap' ? UNKNOWN : received)
      flows.push({
        effectIndex,
        token: effect.tokenIn,
        tokenOut: effect.tokenOut,
        conversion: effect.kind,
        ...getEnds(effect.from, effect.to, effect.tokenIn, effect.tokenOut),
        portionBips: null,
        isHiddenLeak: false
      })
    }
  }

  const applyPeripheryPayment = (effect: ConvertEffect) => {
    const swap: ConvertEffect = { ...effect, isPaidWithEthWhenHeld: undefined }
    const canBePaidWithEth =
      !!ctx.wrappedNative && effect.tokenIn === ctx.wrappedNative && ctx.callValue > 0n
    if (!canBePaidWithEth || !ctx.wrappedNative) {
      apply({ ...swap, from: USER })
      return
    }

    const wrappedTokensKey = getNodeKey(ROUTER, ctx.wrappedNative)
    const wrappedTokensBefore = states.get(wrappedTokensKey)

    // The amount is not known for a swap with an exact output, so the held ETH can never be
    // proven to cover it. Then both ways of paying stay possible.
    const heldEth = getState(getNodeKey(ROUTER, NATIVE_TOKEN))
    if (
      effect.amountIn.kind === 'exact' &&
      heldEth.kind === 'exact' &&
      heldEth.value >= effect.amountIn.value
    ) {
      // the router has the ETH, so it wraps it and does not take the wrapped token from the signer
      apply(convert('wrap', NATIVE_TOKEN, ctx.wrappedNative, ROUTER, ROUTER, effect.amountIn))
    } else {
      // it is not known which of the two is used, so both are possible
      apply(transfer(ctx.wrappedNative, USER, ROUTER, effect.amountIn))
      apply(convert('wrap', NATIVE_TOKEN, ctx.wrappedNative, ROUTER, ROUTER, UNKNOWN))
    }
    apply({ ...swap, from: ROUTER })

    // The swap pays only what it needs, so the wrapped tokens of an unknown amount are all used by
    // the swap itself. Without this, the router would look like it keeps wrapped tokens after every
    // swap with an exact output.
    if (effect.amountIn.kind !== 'exact') {
      if (wrappedTokensBefore) states.set(wrappedTokensKey, wrappedTokensBefore)
      else states.delete(wrappedTokensKey)
    }
  }

  effects.forEach((effect) => {
    if (effect.type === 'convert' && effect.isPaidWithEthWhenHeld) applyPeripheryPayment(effect)
    else apply(effect)
  })

  // the small payments to other addresses that are not shown
  const sharesByToken = new Map<string, bigint[]>()
  flows.forEach((flow) => {
    if (flow.portionBips === null || flow.toPlace?.kind !== 'external') return
    const shares = sharesByToken.get(flow.tokenOut)
    if (shares) shares.push(flow.portionBips)
    else sharesByToken.set(flow.tokenOut, [flow.portionBips])
  })
  const isSmallByToken = new Map<string, boolean>()
  sharesByToken.forEach((shares, token) => isSmallByToken.set(token, isSmallTotalShare(shares)))
  flows.forEach((flow) => {
    if (flow.portionBips === null || flow.toPlace?.kind !== 'external') return
    flow.isHiddenLeak = isSmallByToken.get(flow.tokenOut) ?? false
  })

  // flows that meet in a place that passes tokens on are one group
  const parents = new Map<string, string>()
  const findRoot = (nodeKey: string): string => {
    const parent = parents.get(nodeKey)
    if (parent === undefined || parent === nodeKey) return nodeKey
    const root = findRoot(parent)
    parents.set(nodeKey, root)
    return root
  }
  flows.forEach(({ fromNode, toNode }) => {
    if (fromNode && toNode) parents.set(findRoot(fromNode), findRoot(toNode))
  })

  const flowsByGroup = new Map<string, Flow[]>()
  flows.forEach((flow, index) => {
    const node = flow.fromNode ?? flow.toNode
    const groupKey = node ? findRoot(node) : `alone:${index}`
    const groupFlows = flowsByGroup.get(groupKey)
    if (groupFlows) groupFlows.push(flow)
    else flowsByGroup.set(groupKey, [flow])
  })

  const groups: Group[] = [...flowsByGroup.values()].map((groupFlows) => {
    const terminals = new Map<string, Terminal & { allHidden: boolean; shares: bigint[] | null }>()
    groupFlows.forEach((flow) => {
      if (!flow.toPlace) return
      const terminalKey = `${getPlaceKey(flow.toPlace)}|${flow.tokenOut}`
      const terminal = terminals.get(terminalKey)
      const isOnlyShares = (terminal ? terminal.shares !== null : true) && flow.portionBips !== null
      const shares = isOnlyShares ? (terminal?.shares ?? []) : null
      if (shares && flow.portionBips !== null) shares.push(flow.portionBips)
      terminals.set(terminalKey, {
        place: flow.toPlace,
        token: flow.tokenOut,
        isHidden: false,
        shareBips: null,
        allHidden: (terminal ? terminal.allHidden : true) && flow.isHiddenLeak,
        shares
      })
    })

    return {
      flows: groupFlows,
      userPaid: [...new Set(groupFlows.filter((flow) => flow.fromUser).map((flow) => flow.token))],
      conversions: [
        ...new Set(groupFlows.flatMap((flow) => (flow.conversion ? [flow.conversion] : [])))
      ],
      terminals: [...terminals.values()].map(({ place, token, allHidden, shares }) => ({
        place,
        token,
        isHidden: allHidden,
        shareBips: shares ? getTotalShareBips(shares) : null
      })),
      holdingPlaces: []
    }
  })

  // every flow that touches a node is in the group of the node, so one lookup finds the group
  const groupByRoot = new Map<string, Group>()
  groups.forEach((group) =>
    group.flows.forEach(({ fromNode, toNode }) => {
      if (fromNode) groupByRoot.set(findRoot(fromNode), group)
      if (toNode) groupByRoot.set(findRoot(toNode), group)
    })
  )
  const groupOfNode = (nodeKey: string) => groupByRoot.get(findRoot(nodeKey))

  // tokens that stay in a router or in a pool. The V4 pool manager does not appear here, because it
  // reverts when a call ends and it still holds tokens of the call.
  const stranded: Outcome['stranded'] = []
  states.forEach((state, nodeKey) => {
    if (state.kind === 'zero') return
    const [placeKey, token] = nodeKey.split('|')
    if (!placeKey || !token || placeKey === 'v4') return
    // the tokens that stay are only a small share that was taken into this place
    const shares = shareInflows.get(nodeKey)
    if (shares && !nodesWithOtherInflows.has(nodeKey) && isSmallTotalShare(shares)) return
    const group = groupOfNode(nodeKey)
    if (!group?.userPaid.length) return
    const place: Place =
      placeKey === 'router' ? ROUTER : { kind: 'pool', address: placeKey.slice(5) }
    stranded.push({ place, token })
    group.holdingPlaces.push({ place, token })
  })

  return { groups, effects: resolvedEffects, flows, permits, opaque, stranded }
}
