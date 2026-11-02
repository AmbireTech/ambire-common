/**
 * Checks the summary of the Uniswap humanizer against what really happens to the tokens.
 *
 * Random lists of effects run on a small executor with real balances and random swap rates. After
 * each run, the summary must cover every change of a balance:
 * - every token that the signer pays is in the summary
 * - every token that the signer receives is in the summary
 * - every address that receives tokens is in the summary. The only exception is a small payment
 *   (at most 1% of the tokens that passed through the router)
 * - every token that stays in the router or in a pool is reported
 *
 * The executor does not use the ledger or the renderer, so a mistake in them can be found.
 */
import { expect } from '@jest/globals'

import { HumanizerVisualization } from '../../interfaces'
import {
  ALL,
  Amount,
  Effect,
  NATIVE_TOKEN,
  Place,
  ROUTER,
  UNKNOWN,
  USER,
  UniswapContext,
  V4,
  exact,
  getPlaceKey,
  isPassThroughPlace,
  portion
} from './effects'
import { buildOutcome } from './ledger'
import { renderOutcome } from './render'

const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const TOKENS = [NATIVE_TOKEN, WETH, '0xaaaa', '0xbbbb', '0xcccc']
const EXTERNAL_ADDRESSES = ['0x1111111111111111111111111111111111111111', '0x2222']
const POOL: Place = { kind: 'pool', address: '0x3333' }
const PLACES: Place[] = [
  USER,
  ROUTER,
  V4,
  POOL,
  ...EXTERNAL_ADDRESSES.map((address): Place => ({ kind: 'external', address }))
]
const INTERNAL_PLACES = PLACES.filter(isPassThroughPlace)

const ctx: UniswapContext = {
  accountAddr: '0xuser',
  routerAddr: '0xrouter',
  callValue: 0n,
  chainId: 1n,
  wrappedNative: WETH
}

// a small generator of numbers, so that a failure can be repeated
const createRandom = (seed: number) => {
  let state = seed
  const next = (maxExclusive: number) => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return Math.floor((state / 4294967296) * maxExclusive)
  }
  return {
    next,
    pick: <T>(items: T[]): T => items[next(items.length)]!,
    // the numbers of the amounts that the generator uses
    number: (max: number) => BigInt(1 + next(max))
  }
}

type Random = ReturnType<typeof createRandom>

// ---------------------------------------------------------------- the executor
class Revert extends Error {}

const USER_BALANCE = 10n ** 12n

const createExecutor = (random: Random) => {
  const balances = new Map<string, bigint>()
  const received = new Map<string, bigint>()
  // all that was put in places that pass tokens on, by token
  const passedThrough = new Map<string, bigint>()
  // what the signer receives minus what the signer pays, by token
  const userNet = new Map<string, bigint>()
  const paidByUser = new Set<string>()

  const key = (place: Place, token: string) => `${getPlaceKey(place)}|${token}`
  const balanceOf = (place: Place, token: string) =>
    place.kind === 'user' ? USER_BALANCE : (balances.get(key(place, token)) ?? 0n)

  const take = (place: Place, token: string, amount: bigint) => {
    if (place.kind === 'user') {
      if (amount > 0n) paidByUser.add(token)
      userNet.set(token, (userNet.get(token) ?? 0n) - amount)
      return
    }
    const balance = balanceOf(place, token)
    if (amount > balance) throw new Revert('not enough tokens')
    balances.set(key(place, token), balance - amount)
  }

  const give = (place: Place, token: string, amount: bigint) => {
    if (amount === 0n) return
    if (place.kind === 'user') {
      userNet.set(token, (userNet.get(token) ?? 0n) + amount)
      return
    }
    balances.set(key(place, token), balanceOf(place, token) + amount)
    received.set(key(place, token), (received.get(key(place, token)) ?? 0n) + amount)
    if (isPassThroughPlace(place))
      passedThrough.set(token, (passedThrough.get(token) ?? 0n) + amount)
  }

  // how many tokens leave the place
  const resolve = (place: Place, token: string, amount: Amount): bigint => {
    if (amount.kind === 'exact') return amount.value
    const balance = balanceOf(place, token)
    if (amount.kind === 'all') return balance
    if (amount.kind === 'portion') return (balance * amount.bips) / 10000n
    // an amount that is not known: some of what the place holds
    return BigInt(random.next(Number(balance > 1000n ? 1000n : balance) + 1))
  }

  const apply = (effect: Effect) => {
    if (effect.type === 'transfer') {
      const amount = resolve(effect.from, effect.token, effect.amount)
      take(effect.from, effect.token, amount)
      give(effect.to, effect.token, amount)
    }
    if (effect.type === 'convert') {
      const amount = resolve(effect.from, effect.tokenIn, effect.amountIn)
      take(effect.from, effect.tokenIn, amount)
      // a swap has a rate that is not known. A wrap and an unwrap keep the amount.
      give(
        effect.to,
        effect.tokenOut,
        effect.kind === 'swap' ? amount * BigInt(1 + random.next(5)) : amount
      )
    }
  }

  return { apply, balances, balanceOf, passedThrough, paidByUser, userNet, received }
}

// ---------------------------------------------------------------- the generator
const randomAmount = (random: Random, canBeAll: boolean): Amount => {
  const options: Amount[] = [
    exact(random.number(300)),
    UNKNOWN,
    portion(BigInt(random.next(10001))),
    // a small share is common: it is the fee of an interface
    portion(BigInt(random.next(101)))
  ]
  if (canBeAll) options.push(ALL, ALL)
  return random.pick(options)
}

const randomEffect = (random: Random): Effect => {
  const from = random.pick(
    PLACES.filter((place) => place.kind === 'user' || isPassThroughPlace(place))
  )
  const to = random.pick(PLACES)
  const token = random.pick(TOKENS)
  // the signer only pays amounts that are known
  const amount = from.kind === 'user' ? exact(random.number(300)) : randomAmount(random, true)

  if (random.next(3) === 0) {
    const kind = random.pick(['swap', 'swap', 'wrap', 'unwrap'] as const)
    // a wrap and an unwrap are always between the native token and the wrapped one
    const tokens: [string, string] =
      kind === 'wrap'
        ? [NATIVE_TOKEN, WETH]
        : kind === 'unwrap'
          ? [WETH, NATIVE_TOKEN]
          : [token, random.pick(TOKENS)]
    return {
      type: 'convert',
      kind,
      tokenIn: tokens[0],
      tokenOut: tokens[1],
      from,
      to,
      amountIn: amount
    }
  }
  return { type: 'transfer', token, from, to, amount }
}

// Most of the effects start with a payment of the signer to the router, so that the others have
// tokens to move
const randomEffects = (random: Random): Effect[] => {
  const effects: Effect[] = []
  const payments = 1 + random.next(2)
  for (let i = 0; i < payments; i++) {
    effects.push({
      type: 'transfer',
      token: random.pick(TOKENS),
      from: USER,
      to: random.pick(INTERNAL_PLACES),
      amount: exact(100n + random.number(900))
    })
  }
  const count = 1 + random.next(6)
  for (let i = 0; i < count; i++) effects.push(randomEffect(random))
  if (random.next(10) === 0) {
    effects.splice(random.next(effects.length), 0, { type: 'opaque', reason: 'test' })
  }
  return effects
}

// ---------------------------------------------------------------- the checks
const tokensIn = (visualization: HumanizerVisualization[]) =>
  new Set(visualization.flatMap((item) => (item.type === 'token' ? [item.address] : [])))
const addressesIn = (visualization: HumanizerVisualization[]) =>
  new Set(
    visualization.flatMap((item) => (item.type === 'address' && item.address ? [item.address] : []))
  )

// true when every effect that puts the token in the place takes a share of what another place holds
const isOnlyShares = (effects: Effect[], place: Place, token: string) => {
  const putsTokenInPlace = (effect: Effect) =>
    (effect.type === 'transfer' &&
      effect.token === token &&
      getPlaceKey(effect.to) === getPlaceKey(place)) ||
    (effect.type === 'convert' &&
      effect.tokenOut === token &&
      getPlaceKey(effect.to) === getPlaceKey(place))
  const inflows = effects.filter(putsTokenInPlace)

  return (
    inflows.length > 0 &&
    inflows.every((effect) => effect.type === 'transfer' && effect.amount.kind === 'portion')
  )
}

const checkScenario = (effects: Effect[], random: Random): 'valid' | 'reverted' => {
  const executor = createExecutor(random)
  try {
    effects.forEach(executor.apply)
  } catch (error) {
    if (error instanceof Revert) return 'reverted'
    throw error
  }

  // The V4 pool manager reverts when a call ends and it still holds tokens of the call
  const isV4Unsettled = TOKENS.some((token) => executor.balanceOf(V4, token) !== 0n)
  if (isV4Unsettled) return 'reverted'

  const outcome = buildOutcome(effects, ctx)
  const { visualization } = renderOutcome(outcome, ctx, undefined)
  const shownTokens = tokensIn(visualization)
  const shownAddresses = addressesIn(visualization)
  const describe = () => JSON.stringify(effects, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))

  executor.userNet.forEach((net, token) => {
    // every token that the signer loses is shown
    if (net < 0n && !shownTokens.has(token)) {
      throw new Error(`lost token ${token} is not shown: ${describe()}`)
    }
    // every token that the signer gains is shown, or is one that the signer also paid
    if (net > 0n && !shownTokens.has(token) && !executor.paidByUser.has(token)) {
      throw new Error(`received token ${token} is not shown: ${describe()}`)
    }
  })

  // every address that receives tokens is shown, unless the tokens are a small part of what the
  // router held
  EXTERNAL_ADDRESSES.forEach((address) => {
    const place: Place = { kind: 'external', address }
    TOKENS.forEach((token) => {
      const total = executor.received.get(`${getPlaceKey(place)}|${token}`) ?? 0n
      if (total === 0n || shownAddresses.has(address)) return
      const passed = executor.passedThrough.get(token) ?? 0n
      if (total * 100n > passed) {
        throw new Error(`${address} receives ${total} of ${token} and is not shown: ${describe()}`)
      }
    })
  })

  // every token that stays in a router or in a pool is reported
  INTERNAL_PLACES.forEach((place) => {
    if (place.kind === 'v4') return
    TOKENS.forEach((token) => {
      const balance = executor.balanceOf(place, token)
      if (balance === 0n) return
      const isReported = outcome.stranded.some(
        (item) => getPlaceKey(item.place) === getPlaceKey(place) && item.token === token
      )
      // a small share (the fee of an interface) that is taken into a router is not reported
      const isSmallShare =
        isOnlyShares(effects, place, token) &&
        balance * 100n <= (executor.passedThrough.get(token) ?? 0n)
      if (!isReported && !isSmallShare) {
        throw new Error(
          `${getPlaceKey(place)} keeps ${token} and it is not reported: ${describe()}`
        )
      }
    })
  })
  return 'valid'
}

describe('the summary of the Uniswap humanizer covers what happens to the tokens', () => {
  test.each(Array.from({ length: 12 }, (_, i) => i + 1))('random effects, seed %i', (seed) => {
    const random = createRandom(seed * 104729)
    let validScenarios = 0

    for (let round = 0; round < 1500; round++) {
      const effects = randomEffects(random)
      // the executor needs a copy of the generator, so that the same effects get the same numbers
      if (checkScenario(effects, createRandom(seed * 7 + round)) === 'valid') validScenarios++
    }

    // the check means nothing if almost all the scenarios revert
    expect(validScenarios).toBeGreaterThan(150)
  })
})
