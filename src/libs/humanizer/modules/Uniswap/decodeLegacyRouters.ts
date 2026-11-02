import { Abi, AbiFunction, Hex, decodeFunctionData, toFunctionSelector } from 'viem'

import { HumanizerVisualization } from '../../interfaces'
import {
  ALL,
  CONTRACT_BALANCE,
  ConvertEffect,
  Effect,
  NATIVE_TOKEN,
  Place,
  RecipientRules,
  ROUTER,
  UNKNOWN,
  USER,
  UniswapContext,
  convert,
  getPlace,
  exact,
  portion,
  transfer
} from './effects'
import {
  swapETHForExactTokensAbi,
  swapExactETHForTokensAbi,
  swapExactTokensForETHAbi,
  swapExactTokensForTokensAbi,
  swapTokensForExactETHAbi,
  swapTokensForExactTokensAbi
} from './uniV2'
import {
  exactInputSingleNoDeadlineAbi,
  exactInputSingleWithDeadlineAbi,
  exactInputV32Abi,
  exactInputV3Abi,
  exactOutputSingleNoDeadlineAbi,
  exactOutputSingleWithDeadlineAbi,
  exactOutputV32Abi,
  exactOutputV3Abi,
  multicallBytesAbi,
  multicallDeadlineAbi,
  multicallPrevBlockHashAbi,
  refundETHAbi,
  sweepTokenNoRecipientAbi,
  sweepTokenWithFeeNoRecipientAbi,
  sweepTokenWithFeeWithRecipientAbi,
  sweepTokenWithRecipientAbi,
  swapExactTokensForTokensV32Abi,
  swapTokensForExactTokensV32Abi,
  unwrapWETH9NoRecipientAbi,
  unwrapWETH9WithFeeAbi,
  unwrapWETH9WithRecipientAbi
} from './uniV3'
import { parsePath } from './utils'

/**
 * The older Uniswap routers: the V2 router, the V3 router (SwapRouter) and the V3 router 2
 * (SwapRouter02). Their swap, payment and multicall functions become the same effects as the
 * commands of the Universal Router. The functions that add or remove liquidity are not swaps, and
 * they keep their own description.
 */

const V2_ROUTER: RecipientRules = { hasConstants: false, isZeroTheRouter: false }
const V3_ROUTER: RecipientRules = { hasConstants: false, isZeroTheRouter: true }
const V3_ROUTER_2: RecipientRules = { hasConstants: true, isZeroTheRouter: false }
// the payment functions send to the address they get, or to the caller when they get none
const PAYMENT: RecipientRules = { hasConstants: false, isZeroTheRouter: false }

export type DescribeUnknownCall = (data: Hex) => HumanizerVisualization[]

// V3 router 2 swaps the tokens that it holds when the amount is all of them. A swap that the signer
// pays can be paid with the ETH of the call instead.
const getV3Swap = (
  tokenIn: string,
  tokenOut: string,
  to: Place,
  amountIn: bigint | undefined
): ConvertEffect =>
  amountIn === CONTRACT_BALANCE
    ? convert('swap', tokenIn, tokenOut, ROUTER, to, ALL, false)
    : convert(
        'swap',
        tokenIn,
        tokenOut,
        USER,
        to,
        amountIn === undefined ? UNKNOWN : exact(amountIn),
        true
      )

const getLastToken = (path: readonly string[]) => path[path.length - 1] ?? ''

type Decoded = { effects: Effect[]; deadline?: bigint }
type Decoder = (
  args: readonly any[],
  ctx: UniswapContext,
  describeUnknownCall: DescribeUnknownCall
) => Decoded

const decoders: {
  [selector: string]: (data: Hex, ctx: UniswapContext, describe: DescribeUnknownCall) => Decoded
} = {}

// Registers the decoder of a function, with the arguments that it has already decoded
const register = (abi: Abi, decoder: Decoder) => {
  decoders[toFunctionSelector(abi[0] as AbiFunction)] = (data, ctx, describeUnknownCall) =>
    decoder(decodeFunctionData({ abi, data }).args ?? [], ctx, describeUnknownCall)
}

// ---------------- the V2 router ----------------
// These functions take the tokens of the signer, or the ETH that is sent with the call, and send
// the result to `to`. For each one: where the path, the recipient and the deadline are in the
// arguments, and which token is the native one when it is not in the path.
const V2_SWAPS: [Abi, { path: number; to: number; deadline: number; native?: 'in' | 'out' }][] = [
  [swapExactTokensForTokensAbi, { path: 2, to: 3, deadline: 4 }],
  [swapTokensForExactTokensAbi, { path: 2, to: 3, deadline: 4 }],
  [swapExactETHForTokensAbi, { path: 1, to: 2, deadline: 3, native: 'in' }],
  [swapETHForExactTokensAbi, { path: 1, to: 2, deadline: 3, native: 'in' }],
  [swapTokensForExactETHAbi, { path: 2, to: 3, deadline: 4, native: 'out' }],
  [swapExactTokensForETHAbi, { path: 2, to: 3, deadline: 4, native: 'out' }]
]
V2_SWAPS.forEach(([abi, { path, to, deadline, native }]) =>
  register(abi, (args, ctx) => {
    const route: string[] = args[path]
    return {
      effects: [
        convert(
          'swap',
          native === 'in' ? NATIVE_TOKEN : (route[0] ?? ''),
          native === 'out' ? NATIVE_TOKEN : getLastToken(route),
          USER,
          getPlace(args[to], ctx, V2_ROUTER),
          UNKNOWN
        )
      ],
      deadline: args[deadline]
    }
  })
)

// ---------------- the V3 routers ----------------
// The swaps that have a struct of parameters: for each one, the rules for the recipient, whether
// the tokens are in a path, and whether the swap is for an exact output (the amount paid is then
// not known, and the path is in the order of the output).
const V3_STRUCT_SWAPS: [Abi, RecipientRules, { isPath: boolean; isExactOut: boolean }][] = [
  [exactInputSingleWithDeadlineAbi, V3_ROUTER, { isPath: false, isExactOut: false }],
  [exactOutputSingleWithDeadlineAbi, V3_ROUTER, { isPath: false, isExactOut: true }],
  [exactInputV3Abi, V3_ROUTER, { isPath: true, isExactOut: false }],
  [exactOutputV3Abi, V3_ROUTER, { isPath: true, isExactOut: true }],
  [exactInputSingleNoDeadlineAbi, V3_ROUTER_2, { isPath: false, isExactOut: false }],
  [exactOutputSingleNoDeadlineAbi, V3_ROUTER_2, { isPath: false, isExactOut: true }],
  [exactInputV32Abi, V3_ROUTER_2, { isPath: true, isExactOut: false }],
  [exactOutputV32Abi, V3_ROUTER_2, { isPath: true, isExactOut: true }]
]
V3_STRUCT_SWAPS.forEach(([abi, rules, { isPath, isExactOut }]) =>
  register(abi, ([params], ctx) => {
    let [tokenIn, tokenOut] = [params.tokenIn, params.tokenOut]
    if (isPath) {
      const path = parsePath(params.path)
      if (!path.length) throw new Error('V3 swap without a path')
      ;[tokenIn, tokenOut] = isExactOut
        ? [getLastToken(path), path[0]!]
        : [path[0]!, getLastToken(path)]
    }
    return {
      effects: [
        getV3Swap(
          tokenIn,
          tokenOut,
          getPlace(params.recipient, ctx, rules),
          isExactOut ? undefined : params.amountIn
        )
      ],
      deadline: params.deadline
    }
  })
)

// the swaps of the V3 router 2 that take a path of tokens
const V3_ROUTER_2_TOKEN_SWAPS: [Abi, boolean][] = [
  [swapExactTokensForTokensV32Abi, true],
  [swapTokensForExactTokensV32Abi, false]
]
V3_ROUTER_2_TOKEN_SWAPS.forEach(([abi, isExactIn]) =>
  register(abi, (args, ctx) => {
    const path: string[] = args[2]
    const to = getPlace(args[3], ctx, V3_ROUTER_2)
    return {
      effects: [getV3Swap(path[0] ?? '', getLastToken(path), to, isExactIn ? args[0] : undefined)]
    }
  })
)

// ---------------- payments (both V3 routers) ----------------
// the router unwraps all the wrapped tokens that it holds
const getUnwrap = (ctx: UniswapContext): Effect => {
  if (!ctx.wrappedNative) throw new Error('the wrapped native token of the network is unknown')
  return convert('unwrap', ctx.wrappedNative, NATIVE_TOKEN, ROUTER, ROUTER, ALL)
}

// pays a share to the fee recipient, and all that is left to the recipient
const getPaymentWithFee = (
  token: string,
  recipient: Place,
  feeBips: bigint,
  feeRecipient: string
): Effect[] => [
  transfer(
    token,
    ROUTER,
    { kind: 'external', address: feeRecipient.toLowerCase() },
    portion(feeBips)
  ),
  transfer(token, ROUTER, recipient, ALL)
]

register(unwrapWETH9NoRecipientAbi, (_args, ctx) => ({
  effects: [getUnwrap(ctx), transfer(NATIVE_TOKEN, ROUTER, USER, ALL)]
}))
register(unwrapWETH9WithRecipientAbi, ([, recipient], ctx) => ({
  effects: [getUnwrap(ctx), transfer(NATIVE_TOKEN, ROUTER, getPlace(recipient, ctx, PAYMENT), ALL)]
}))
register(unwrapWETH9WithFeeAbi, ([, recipient, feeBips, feeRecipient], ctx) => ({
  effects: [
    getUnwrap(ctx),
    ...getPaymentWithFee(NATIVE_TOKEN, getPlace(recipient, ctx, PAYMENT), feeBips, feeRecipient)
  ]
}))
register(sweepTokenNoRecipientAbi, ([token]) => ({
  effects: [transfer(token, ROUTER, USER, ALL)]
}))
register(sweepTokenWithRecipientAbi, ([token, , recipient], ctx) => ({
  effects: [transfer(token, ROUTER, getPlace(recipient, ctx, PAYMENT), ALL)]
}))
register(sweepTokenWithFeeNoRecipientAbi, ([token, , feeBips, feeRecipient]) => ({
  effects: getPaymentWithFee(token, USER, feeBips, feeRecipient)
}))
register(sweepTokenWithFeeWithRecipientAbi, ([token, , recipient, feeBips, feeRecipient], ctx) => ({
  effects: getPaymentWithFee(token, getPlace(recipient, ctx, PAYMENT), feeBips, feeRecipient)
}))
register(refundETHAbi, () => ({ effects: [transfer(NATIVE_TOKEN, ROUTER, USER, ALL)] }))

// ---------------- multicall ----------------
// A call inside a multicall that is not a swap or a payment is not understood, because it can do
// anything with the tokens of the router.
const decodeCalls = (
  calls: readonly Hex[],
  ctx: UniswapContext,
  describeUnknownCall: DescribeUnknownCall
): Decoded => {
  let deadline: bigint | undefined
  const effects = calls.flatMap((data): Effect[] => {
    const decoded = decodeLegacyFunction(data, ctx, describeUnknownCall)
    if (decoded) {
      deadline = deadline ?? decoded.deadline
      return decoded.effects
    }
    return [
      {
        type: 'opaque',
        reason: `call ${data.slice(0, 10)}`,
        visualization: describeUnknownCall(data)
      }
    ]
  })
  return { effects, deadline }
}

register(multicallDeadlineAbi, ([deadline, calls], ctx, describeUnknownCall) => {
  const decoded = decodeCalls(calls, ctx, describeUnknownCall)
  return { effects: decoded.effects, deadline: decoded.deadline ?? deadline }
})
register(multicallBytesAbi, ([calls], ctx, describeUnknownCall) =>
  decodeCalls(calls, ctx, describeUnknownCall)
)
register(multicallPrevBlockHashAbi, ([, calls], ctx, describeUnknownCall) =>
  decodeCalls(calls, ctx, describeUnknownCall)
)

const decodeLegacyFunction = (
  data: Hex,
  ctx: UniswapContext,
  describeUnknownCall: DescribeUnknownCall
): Decoded | undefined => {
  const decoder = decoders[data.slice(0, 10)]
  if (!decoder) return undefined
  try {
    return decoder(data, ctx, describeUnknownCall)
  } catch {
    // the function does not decode, so it is not understood
    return undefined
  }
}

// The functions of the V2 router that take ETH send it from the signer and do not keep it in the router
const V2_ETH_FUNCTIONS = new Set<string>([
  toFunctionSelector(swapExactETHForTokensAbi[0]),
  toFunctionSelector(swapETHForExactTokensAbi[0])
])

/**
 * Returns the effects of a call to one of the older routers, or `undefined` when the function is
 * not a swap, a payment or a multicall (the functions that add or remove liquidity, for example).
 */
export const decodeLegacyCall = (
  data: Hex,
  ctx: UniswapContext,
  describeUnknownCall: DescribeUnknownCall
): Decoded | undefined => {
  const decoded = decodeLegacyFunction(data, ctx, describeUnknownCall)
  if (!decoded) return undefined

  // the value of the call stays in the router until it is used or sent back
  const holdsValue = ctx.callValue > 0n && !V2_ETH_FUNCTIONS.has(data.slice(0, 10))
  return {
    effects: [
      ...(holdsValue ? [transfer(NATIVE_TOKEN, USER, ROUTER, exact(ctx.callValue), true)] : []),
      ...decoded.effects
    ],
    deadline: decoded.deadline
  }
}

export const isLegacySelector = (selector: string) => !!decoders[selector]
