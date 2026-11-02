import { zeroAddress } from 'viem'

import { HumanizerVisualization } from '../../interfaces'

/**
 * The Uniswap humanizer works in three stages:
 *
 * 1. The decoders (`decodeUniversalRouter.ts`, `decodeLegacyRouters.ts`) turn each command of a call
 *    into effects. An effect says exactly where tokens come from and where they go.
 * 2. The ledger (`ledger.ts`) follows the tokens through the places that only pass them on (the
 *    router, the V4 pool manager, a pool) and returns what is left: what the user pays, and who
 *    receives what.
 * 3. The renderer (`render.ts`) writes the summary from that result.
 *
 * What the user sees is never the result of matching the text of other lines. Everything that the
 * decoders do not understand is an `opaque` effect, and a call with an opaque effect is listed
 * effect by effect and never shortened.
 */

/** The address that stands for the native token (ETH) in all the Uniswap contracts */
export const NATIVE_TOKEN = zeroAddress

/** Universal Router constant: "the caller of the router" (ActionConstants.MSG_SENDER) */
export const MSG_SENDER = '0x0000000000000000000000000000000000000001'
/** Universal Router constant: "the router itself" (ActionConstants.ADDRESS_THIS) */
export const ADDRESS_THIS = '0x0000000000000000000000000000000000000002'
/** Universal Router constant: "all the tokens that the router holds" (ActionConstants.CONTRACT_BALANCE) */
export const CONTRACT_BALANCE = 2n ** 255n

/**
 * A place where tokens can be.
 * - `user`: the wallet of the signer. This is also where the value of the transaction comes from.
 * - `router`, `v4` and `pool`: contracts that only pass tokens on. Tokens that stay there at the
 *   end can be taken by anyone.
 * - `external`: any other address. The tokens that go there are lost for the user.
 */
export type Place =
  | { kind: 'user' }
  | { kind: 'router' }
  | { kind: 'v4' }
  | { kind: 'pool'; address: string }
  | { kind: 'external'; address: string }

export const USER: Place = { kind: 'user' }
export const ROUTER: Place = { kind: 'router' }
export const V4: Place = { kind: 'v4' }

export const isPassThroughPlace = (place: Place): boolean =>
  place.kind === 'router' || place.kind === 'v4' || place.kind === 'pool'

export const getPlaceKey = (place: Place): string =>
  place.kind === 'pool' || place.kind === 'external' ? `${place.kind}:${place.address}` : place.kind

/** How many tokens an effect moves */
export type Amount =
  | { kind: 'exact'; value: bigint }
  /** everything that the place holds at that moment */
  | { kind: 'all' }
  /** a share of what the place holds, in basis points (1 bip = 0.01%) */
  | { kind: 'portion'; bips: bigint }
  /** not known when the call is signed (for example what a swap returns) */
  | { kind: 'unknown' }

export const exact = (value: bigint): Amount => ({ kind: 'exact', value })
export const ALL: Amount = { kind: 'all' }
export const UNKNOWN: Amount = { kind: 'unknown' }
export const portion = (bips: bigint): Amount => ({ kind: 'portion', bips })

/** The Universal Router uses the largest numbers of 256 bits as "all the tokens that it holds" */
export const toAmount = (value: bigint): Amount => (value === CONTRACT_BALANCE ? ALL : exact(value))

export type ConversionKind = 'swap' | 'wrap' | 'unwrap'

export type TransferEffect = {
  type: 'transfer'
  token: string
  from: Place
  to: Place
  amount: Amount
  /** The value of the transaction. It is already shown with the call, so it is not listed again. */
  isCallValue?: boolean
}

/** Tokens of one kind go in and tokens of another kind come out (a swap, a wrap or an unwrap) */
export type ConvertEffect = {
  type: 'convert'
  kind: ConversionKind
  tokenIn: string
  tokenOut: string
  from: Place
  to: Place
  amountIn: Amount
  /**
   * The router takes the payment from the signer only when it does not already hold ETH for it:
   * a swap that pays with the wrapped native token uses the ETH of the transaction first
   * (`PeripheryPayments.pay` of Uniswap V3)
   */
  isPaidWithEthWhenHeld?: boolean
}

/** How a router reads an address that is the recipient of its tokens */
export type RecipientRules = {
  /** 1 is the caller and 2 is the router itself (Universal Router, V3 router 2) */
  hasConstants: boolean
  /** the zero address is the router itself (V3 router) */
  isZeroTheRouter: boolean
  /** the pools that are paid by an earlier command of the call */
  pools?: Set<string>
}

/** The place that an address stands for: the signer, the router, a pool of the call, or another address */
export const getPlace = (address: string, ctx: UniswapContext, rules: RecipientRules): Place => {
  const lowerCaseAddress = address.toLowerCase()
  if (lowerCaseAddress === ctx.accountAddr) return USER
  if (rules.hasConstants && lowerCaseAddress === MSG_SENDER) return USER
  if (rules.hasConstants && lowerCaseAddress === ADDRESS_THIS) return ROUTER
  if (rules.isZeroTheRouter && lowerCaseAddress === NATIVE_TOKEN) return ROUTER
  if (lowerCaseAddress === ctx.routerAddr) return ROUTER
  if (rules.pools?.has(lowerCaseAddress)) return { kind: 'pool', address: lowerCaseAddress }
  return { kind: 'external', address: lowerCaseAddress }
}

/** A transfer of tokens. The token is kept in lower case, as everywhere in the ledger. */
export const transfer = (
  token: string,
  from: Place,
  to: Place,
  amount: Amount,
  isCallValue?: boolean
): TransferEffect => ({
  type: 'transfer',
  token: token.toLowerCase(),
  from,
  to,
  amount,
  ...(isCallValue ? { isCallValue } : {})
})

/** A conversion of tokens (a swap, a wrap or an unwrap) */
export const convert = (
  kind: ConversionKind,
  tokenIn: string,
  tokenOut: string,
  from: Place,
  to: Place,
  amountIn: Amount,
  isPaidWithEthWhenHeld?: boolean
): ConvertEffect => ({
  type: 'convert',
  kind,
  tokenIn: tokenIn.toLowerCase(),
  tokenOut: tokenOut.toLowerCase(),
  from,
  to,
  amountIn,
  ...(isPaidWithEthWhenHeld === undefined ? {} : { isPaidWithEthWhenHeld })
})

export type PermitEffect = {
  type: 'permit'
  token: string
  spender: string
  amount: bigint
}

/** A command that the decoders do not understand. It can do anything with the tokens. */
export type OpaqueEffect = {
  type: 'opaque'
  reason: string
  /** How the command is described, when there is a description */
  visualization?: HumanizerVisualization[]
}

export type Effect = TransferEffect | ConvertEffect | PermitEffect | OpaqueEffect

/** What the decoders and the ledger need to know about the call */
export type UniswapContext = {
  /** the signer, in lower case */
  accountAddr: string
  /** the contract that is called, in lower case */
  routerAddr: string
  /** the value of the transaction */
  callValue: bigint
  chainId: bigint
  /** the wrapped native token of the network, in lower case, when it is known */
  wrappedNative?: string
}
