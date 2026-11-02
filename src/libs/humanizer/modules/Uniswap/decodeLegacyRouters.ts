import { Hex, decodeFunctionData, toFunctionSelector } from 'viem'

import { HumanizerVisualization } from '../../interfaces'
import {
  ADDRESS_THIS,
  ALL,
  Amount,
  CONTRACT_BALANCE,
  ConvertEffect,
  Effect,
  MSG_SENDER,
  NATIVE_TOKEN,
  Place,
  ROUTER,
  UNKNOWN,
  USER,
  UniswapContext,
  exact,
  portion
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

// How the router reads the recipient of a swap
type RecipientRules = {
  // 1 is the caller and 2 is the router itself (V3 router 2)
  hasConstants: boolean
  // the zero address is the router itself (V3 router)
  isZeroTheRouter: boolean
}

const V2_ROUTER: RecipientRules = { hasConstants: false, isZeroTheRouter: false }
const V3_ROUTER: RecipientRules = { hasConstants: false, isZeroTheRouter: true }
const V3_ROUTER_2: RecipientRules = { hasConstants: true, isZeroTheRouter: false }
// the payment functions send to the address they get, or to the caller when they get none
const PAYMENT: RecipientRules = { hasConstants: false, isZeroTheRouter: false }

type LegacyDecoder = (
  data: Hex,
  ctx: UniswapContext,
  describeUnknownCall: DescribeUnknownCall
) => { effects: Effect[]; deadline?: bigint }

export type DescribeUnknownCall = (data: Hex) => HumanizerVisualization[]

const getPlace = (address: string, rules: RecipientRules, ctx: UniswapContext): Place => {
  const lowerCaseAddress = address.toLowerCase()
  if (lowerCaseAddress === ctx.accountAddr) return USER
  if (rules.hasConstants && lowerCaseAddress === MSG_SENDER) return USER
  if (rules.hasConstants && lowerCaseAddress === ADDRESS_THIS) return ROUTER
  if (rules.isZeroTheRouter && lowerCaseAddress === NATIVE_TOKEN) return ROUTER
  if (lowerCaseAddress === ctx.routerAddr) return ROUTER
  return { kind: 'external', address: lowerCaseAddress }
}

// A V3 swap that is paid by the signer. The router can pay it with the ETH of the call instead.
const getUserPaidSwap = (
  tokenIn: string,
  tokenOut: string,
  to: Place,
  amountIn: Amount,
  isPaidWithEthWhenHeld: boolean
): ConvertEffect => ({
  type: 'convert',
  kind: 'swap',
  tokenIn: tokenIn.toLowerCase(),
  tokenOut: tokenOut.toLowerCase(),
  from: USER,
  to,
  amountIn,
  isPaidWithEthWhenHeld
})

// V3 router 2 swaps the tokens that it holds when the amount is all of them
const getV3Swap = (
  tokenIn: string,
  tokenOut: string,
  to: Place,
  amountIn: bigint | undefined
): ConvertEffect => {
  if (amountIn === CONTRACT_BALANCE) {
    return { ...getUserPaidSwap(tokenIn, tokenOut, to, ALL, false), from: ROUTER }
  }
  return getUserPaidSwap(
    tokenIn,
    tokenOut,
    to,
    amountIn === undefined ? UNKNOWN : exact(amountIn),
    true
  )
}

const getLastToken = (path: readonly string[]) => path[path.length - 1] ?? ''

const decoders: { [selector: string]: LegacyDecoder } = {}

const add = (abi: readonly [{ name: string }], decoder: LegacyDecoder) => {
  decoders[toFunctionSelector(abi[0] as Parameters<typeof toFunctionSelector>[0])] = decoder
}

// ---------------- the V2 router ----------------
// These functions take the tokens of the signer, or the ETH that is sent with the call, and send
// the result to `to`.
const getV2Swap = (
  ctx: UniswapContext,
  tokenIn: string,
  tokenOut: string,
  to: string,
  deadline: bigint
) => ({
  effects: [
    {
      type: 'convert',
      kind: 'swap',
      tokenIn: tokenIn.toLowerCase(),
      tokenOut: tokenOut.toLowerCase(),
      from: USER,
      to: getPlace(to, V2_ROUTER, ctx),
      amountIn: UNKNOWN
    } as Effect
  ],
  deadline
})

add(swapExactTokensForTokensAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: swapExactTokensForTokensAbi, data })
  const [, , path, to, deadline] = args
  return getV2Swap(ctx, path[0] ?? '', getLastToken(path), to, deadline)
})
add(swapTokensForExactTokensAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: swapTokensForExactTokensAbi, data })
  const [, , path, to, deadline] = args
  return getV2Swap(ctx, path[0] ?? '', getLastToken(path), to, deadline)
})
add(swapExactETHForTokensAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: swapExactETHForTokensAbi, data })
  const [, path, to, deadline] = args
  return getV2Swap(ctx, NATIVE_TOKEN, getLastToken(path), to, deadline)
})
add(swapETHForExactTokensAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: swapETHForExactTokensAbi, data })
  const [, path, to, deadline] = args
  return getV2Swap(ctx, NATIVE_TOKEN, getLastToken(path), to, deadline)
})
add(swapTokensForExactETHAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: swapTokensForExactETHAbi, data })
  const [, , path, to, deadline] = args
  return getV2Swap(ctx, path[0] ?? '', NATIVE_TOKEN, to, deadline)
})
add(swapExactTokensForETHAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: swapExactTokensForETHAbi, data })
  const [, , path, to, deadline] = args
  return getV2Swap(ctx, path[0] ?? '', NATIVE_TOKEN, to, deadline)
})

// ---------------- the V3 router (SwapRouter) ----------------
add(exactInputSingleWithDeadlineAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: exactInputSingleWithDeadlineAbi, data })
  const [params] = args
  return {
    effects: [
      getV3Swap(
        params.tokenIn,
        params.tokenOut,
        getPlace(params.recipient, V3_ROUTER, ctx),
        params.amountIn
      )
    ],
    deadline: params.deadline
  }
})
add(exactOutputSingleWithDeadlineAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: exactOutputSingleWithDeadlineAbi, data })
  const [params] = args
  return {
    effects: [
      getV3Swap(
        params.tokenIn,
        params.tokenOut,
        getPlace(params.recipient, V3_ROUTER, ctx),
        undefined
      )
    ],
    deadline: params.deadline
  }
})
add(exactInputV3Abi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: exactInputV3Abi, data })
  const [params] = args
  const path = parsePath(params.path)
  if (!path.length) throw new Error('V3 swap without a path')
  return {
    effects: [
      getV3Swap(
        path[0]!,
        getLastToken(path),
        getPlace(params.recipient, V3_ROUTER, ctx),
        params.amountIn
      )
    ],
    deadline: params.deadline
  }
})
add(exactOutputV3Abi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: exactOutputV3Abi, data })
  const [params] = args
  const path = parsePath(params.path)
  if (!path.length) throw new Error('V3 swap without a path')
  // the path of an exact output swap is in the order of the output
  return {
    effects: [
      getV3Swap(getLastToken(path), path[0]!, getPlace(params.recipient, V3_ROUTER, ctx), undefined)
    ],
    deadline: params.deadline
  }
})

// ---------------- the V3 router 2 (SwapRouter02) ----------------
add(exactInputSingleNoDeadlineAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: exactInputSingleNoDeadlineAbi, data })
  const [params] = args
  return {
    effects: [
      getV3Swap(
        params.tokenIn,
        params.tokenOut,
        getPlace(params.recipient, V3_ROUTER_2, ctx),
        params.amountIn
      )
    ]
  }
})
add(exactOutputSingleNoDeadlineAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: exactOutputSingleNoDeadlineAbi, data })
  const [params] = args
  return {
    effects: [
      getV3Swap(
        params.tokenIn,
        params.tokenOut,
        getPlace(params.recipient, V3_ROUTER_2, ctx),
        undefined
      )
    ]
  }
})
add(exactInputV32Abi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: exactInputV32Abi, data })
  const [params] = args
  const path = parsePath(params.path)
  if (!path.length) throw new Error('V3 swap without a path')
  return {
    effects: [
      getV3Swap(
        path[0]!,
        getLastToken(path),
        getPlace(params.recipient, V3_ROUTER_2, ctx),
        params.amountIn
      )
    ]
  }
})
add(exactOutputV32Abi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: exactOutputV32Abi, data })
  const [params] = args
  const path = parsePath(params.path)
  if (!path.length) throw new Error('V3 swap without a path')
  return {
    effects: [
      getV3Swap(
        getLastToken(path),
        path[0]!,
        getPlace(params.recipient, V3_ROUTER_2, ctx),
        undefined
      )
    ]
  }
})
add(swapExactTokensForTokensV32Abi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: swapExactTokensForTokensV32Abi, data })
  const [amountIn, , path, to] = args
  return {
    effects: [
      getV3Swap(path[0] ?? '', getLastToken(path), getPlace(to, V3_ROUTER_2, ctx), amountIn)
    ]
  }
})
add(swapTokensForExactTokensV32Abi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: swapTokensForExactTokensV32Abi, data })
  const [, , path, to] = args
  return {
    effects: [
      getV3Swap(path[0] ?? '', getLastToken(path), getPlace(to, V3_ROUTER_2, ctx), undefined)
    ]
  }
})

// ---------------- payments (both V3 routers) ----------------
const getUnwrap = (ctx: UniswapContext): Effect => {
  if (!ctx.wrappedNative) throw new Error('the wrapped native token of the network is unknown')
  // the router unwraps all the wrapped tokens that it holds
  return {
    type: 'convert',
    kind: 'unwrap',
    tokenIn: ctx.wrappedNative,
    tokenOut: NATIVE_TOKEN,
    from: ROUTER,
    to: ROUTER,
    amountIn: ALL
  }
}

// pays a share to the fee recipient, and all that is left to the recipient
const getPaymentWithFee = (
  token: string,
  recipient: Place,
  feeBips: bigint,
  feeRecipient: string
): Effect[] => [
  {
    type: 'transfer',
    token,
    from: ROUTER,
    to: { kind: 'external', address: feeRecipient.toLowerCase() },
    amount: portion(feeBips)
  },
  { type: 'transfer', token, from: ROUTER, to: recipient, amount: ALL }
]

add(unwrapWETH9NoRecipientAbi, (data, ctx) => ({
  effects: [
    getUnwrap(ctx),
    { type: 'transfer', token: NATIVE_TOKEN, from: ROUTER, to: USER, amount: ALL }
  ]
}))
add(unwrapWETH9WithRecipientAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: unwrapWETH9WithRecipientAbi, data })
  const [, recipient] = args
  return {
    effects: [
      getUnwrap(ctx),
      {
        type: 'transfer',
        token: NATIVE_TOKEN,
        from: ROUTER,
        to: getPlace(recipient, PAYMENT, ctx),
        amount: ALL
      }
    ]
  }
})
add(unwrapWETH9WithFeeAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: unwrapWETH9WithFeeAbi, data })
  const [, recipient, feeBips, feeRecipient] = args
  return {
    effects: [
      getUnwrap(ctx),
      ...getPaymentWithFee(NATIVE_TOKEN, getPlace(recipient, PAYMENT, ctx), feeBips, feeRecipient)
    ]
  }
})
add(sweepTokenNoRecipientAbi, (data) => {
  const { args } = decodeFunctionData({ abi: sweepTokenNoRecipientAbi, data })
  const [token] = args
  return {
    effects: [{ type: 'transfer', token: token.toLowerCase(), from: ROUTER, to: USER, amount: ALL }]
  }
})
add(sweepTokenWithRecipientAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: sweepTokenWithRecipientAbi, data })
  const [token, , recipient] = args
  return {
    effects: [
      {
        type: 'transfer',
        token: token.toLowerCase(),
        from: ROUTER,
        to: getPlace(recipient, PAYMENT, ctx),
        amount: ALL
      }
    ]
  }
})
add(sweepTokenWithFeeNoRecipientAbi, (data) => {
  const { args } = decodeFunctionData({ abi: sweepTokenWithFeeNoRecipientAbi, data })
  const [token, , feeBips, feeRecipient] = args
  return { effects: getPaymentWithFee(token.toLowerCase(), USER, feeBips, feeRecipient) }
})
add(sweepTokenWithFeeWithRecipientAbi, (data, ctx) => {
  const { args } = decodeFunctionData({ abi: sweepTokenWithFeeWithRecipientAbi, data })
  const [token, , recipient, feeBips, feeRecipient] = args
  return {
    effects: getPaymentWithFee(
      token.toLowerCase(),
      getPlace(recipient, PAYMENT, ctx),
      feeBips,
      feeRecipient
    )
  }
})
add(refundETHAbi, () => ({
  effects: [{ type: 'transfer', token: NATIVE_TOKEN, from: ROUTER, to: USER, amount: ALL }]
}))

// ---------------- multicall ----------------
// A call inside a multicall that is not a swap or a payment is not understood, because it can do
// anything with the tokens of the router.
const decodeCalls = (
  calls: readonly Hex[],
  ctx: UniswapContext,
  describeUnknownCall: DescribeUnknownCall
) => {
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

add(multicallDeadlineAbi, (data, ctx, describeUnknownCall) => {
  const { args } = decodeFunctionData({ abi: multicallDeadlineAbi, data })
  const [deadline, calls] = args
  const decoded = decodeCalls(calls, ctx, describeUnknownCall)
  return { effects: decoded.effects, deadline: decoded.deadline ?? deadline }
})
add(multicallBytesAbi, (data, ctx, describeUnknownCall) => {
  const { args } = decodeFunctionData({ abi: multicallBytesAbi, data })
  return decodeCalls(args[0], ctx, describeUnknownCall)
})
add(multicallPrevBlockHashAbi, (data, ctx, describeUnknownCall) => {
  const { args } = decodeFunctionData({ abi: multicallPrevBlockHashAbi, data })
  return decodeCalls(args[1], ctx, describeUnknownCall)
})

const decodeLegacyFunction = (
  data: Hex,
  ctx: UniswapContext,
  describeUnknownCall: DescribeUnknownCall
) => {
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
const V2_ETH_FUNCTIONS = new Set([
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
): { effects: Effect[]; deadline?: bigint } | undefined => {
  const decoded = decodeLegacyFunction(data, ctx, describeUnknownCall)
  if (!decoded) return undefined

  // the value of the call stays in the router until it is used or sent back
  const holdsValue = ctx.callValue > 0n && !V2_ETH_FUNCTIONS.has(data.slice(0, 10))
  return {
    effects: [
      ...(holdsValue
        ? [
            {
              type: 'transfer',
              token: NATIVE_TOKEN,
              from: USER,
              to: ROUTER,
              amount: exact(ctx.callValue)
            } as Effect
          ]
        : []),
      ...decoded.effects
    ],
    deadline: decoded.deadline
  }
}

export const isLegacySelector = (selector: string) => !!decoders[selector]
