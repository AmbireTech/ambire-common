import { AbiCoder } from 'ethers'
import { Hex, isHex } from 'viem'

import { getAction, getAddressVisualization, getLabel } from '../../utils'
import {
  COMMANDS,
  COMMANDS_DESCRIPTIONS,
  V4_ACTION_CODES,
  V4_ACTION_DESCRIPTORS,
  V4_SWAP_ACTION_DESCRIPTORS_WITH_MIN_HOP_PRICE
} from './Commands'
import {
  ADDRESS_THIS,
  ALL,
  Amount,
  Effect,
  MSG_SENDER,
  NATIVE_TOKEN,
  Place,
  ROUTER,
  UNKNOWN,
  USER,
  UniswapContext,
  V4,
  exact,
  portion,
  toAmount
} from './effects'
import { getAerodromePool, getUniswapV2Pool } from './pools'
import { parsePath } from './utils'

const coder = new AbiCoder()

// Decodes the input of a command. Ethers only throws for a field that does not fit when the field is
// read, so all of them are read here. A command that does not decode is never used as if it did.
const extractParams = (inputsDetails: { type: string; name: string }[], input: string) => {
  const decodedInput = coder.decode(
    inputsDetails.map((item) => item.type),
    input
  )
  decodedInput.toArray(true)

  const params: any = {}
  inputsDetails.forEach((item, index) => {
    params[item.name] = decodedInput[index]
  })
  return params
}

// this function splits uniswap commands from single hex string to multiple hex strings
// '0x1234' => ['0x12', '0x34']
export function parseCommands(commands: string): string[] | null {
  // all commands are 1 byte = 2 hex chars
  if (commands.length % 2) return null
  if (!isHex(commands)) return null
  const res: string[] = []
  // iterate over pairs of chars
  for (let i = 2; i < commands.length; i += 2) {
    res.push(`0x${commands.slice(i, i + 2)}`)
  }
  return res
}

// The V2_SWAP_EXACT_IN encoding of the routers that have a `bool isUni` flag
const ALTERNATIVE_V2_SWAP_EXACT_IN_INPUTS_DETAILS = [
  { type: 'address', name: 'recipient' },
  { type: 'uint256', name: 'amountIn' },
  { type: 'uint256', name: 'amountOut' },
  { type: 'bytes', name: 'path' },
  { type: 'bool', name: 'isUserPayer' },
  { type: 'bool', name: 'isUni' }
]

type V2SwapParams = {
  recipient: string
  amountIn: bigint
  tokens: string[]
  payerIsUser: boolean
  /** the pool of the first two tokens, when the factory of the network gives it */
  pool: string | undefined
}

// The path of the alternative encoding is a token, then a byte and a token again for each pool
const parseAlternativePath = (path: string): { tokens: string[]; flags: number[] } | undefined => {
  const body = path.slice(2)
  if (body.length < 40 || (body.length - 40) % 42) return undefined

  const tokens = [`0x${body.slice(0, 40)}`.toLowerCase()]
  const flags: number[] = []
  for (let i = 40; i < body.length; i += 42) {
    flags.push(parseInt(body.slice(i, i + 2), 16))
    tokens.push(`0x${body.slice(i + 2, i + 42)}`.toLowerCase())
  }
  return { tokens, flags }
}

const decodeV2SwapExactIn = (input: string, ctx: UniswapContext): V2SwapParams | undefined => {
  try {
    const params = extractParams(COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_IN.inputsDetails, input)
    const tokens: string[] = params.path.map((token: string) => token.toLowerCase())
    return {
      recipient: params.recipient,
      amountIn: params.amountIn,
      tokens,
      payerIsUser: params.payerIsUser,
      pool:
        tokens.length === 2 && tokens[0] && tokens[1]
          ? getUniswapV2Pool(ctx.chainId, tokens[0], tokens[1])
          : undefined
    }
  } catch {
    // not an error: the input can be in the alternative encoding, that is tried next
  }

  try {
    const params = extractParams(ALTERNATIVE_V2_SWAP_EXACT_IN_INPUTS_DETAILS, input)
    const path = parseAlternativePath(params.path)
    if (!path) return undefined

    const [token0, token1] = path.tokens
    const hasOnePool = path.tokens.length === 2 && token0 && token1
    let pool: string | undefined
    if (hasOnePool && params.isUni) pool = getUniswapV2Pool(ctx.chainId, token0, token1)
    if (hasOnePool && !params.isUni) {
      pool = getAerodromePool(ctx.chainId, token0, token1, path.flags[0] === 1)
    }
    return {
      recipient: params.recipient,
      amountIn: params.amountIn,
      tokens: path.tokens,
      payerIsUser: params.isUserPayer,
      pool
    }
  } catch {
    // the input does not decode in any of the two encodings, so it is not used
    return undefined
  }
}

// `amountIn` = 0 tells the router that the pool of the swap already holds the tokens to swap
const ALREADY_PAID = 0n

const isPrepaidV2Swap = (swap: V2SwapParams) => !swap.payerIsUser && swap.amountIn === ALREADY_PAID

/**
 * The pools that are paid by an earlier command and swap what they hold. They are the only pools
 * that can receive tokens without the tokens being lost.
 */
const getPrepaidPools = (
  commands: string[],
  inputs: readonly Hex[],
  ctx: UniswapContext
): Set<string> => {
  const pools = new Set<string>()
  commands.forEach((command, index) => {
    const input = inputs[index]
    if (command !== COMMANDS.V2_SWAP_EXACT_IN || !input) return
    const swap = decodeV2SwapExactIn(input, ctx)
    if (swap && isPrepaidV2Swap(swap) && swap.pool) pools.add(swap.pool)
  })
  return pools
}

const getPlace = (address: string, ctx: UniswapContext, pools: Set<string>): Place => {
  const lowerCaseAddress = address.toLowerCase()
  if (lowerCaseAddress === MSG_SENDER || lowerCaseAddress === ctx.accountAddr) return USER
  if (lowerCaseAddress === ADDRESS_THIS || lowerCaseAddress === ctx.routerAddr) return ROUTER
  if (pools.has(lowerCaseAddress)) return { kind: 'pool', address: lowerCaseAddress }
  return { kind: 'external', address: lowerCaseAddress }
}

const getOpaqueEffect = (reason: string, ctx: UniswapContext, description?: string): Effect => ({
  type: 'opaque',
  reason,
  visualization: [
    getAction(description || 'Uniswap action'),
    ...(description ? [] : [getLabel('to'), getAddressVisualization(ctx.routerAddr)])
  ]
})

// The swap parameters of the V4 router got a new field (`minHopPriceX36`) in its newer versions.
// They are decoded with the original layout first, and with the new layout when that does not fit.
// The fields that are read after this are in the same place in both layouts.
function extractV4SwapParams(
  swapAction: keyof typeof V4_SWAP_ACTION_DESCRIPTORS_WITH_MIN_HOP_PRICE,
  param: Hex
) {
  try {
    return extractParams(V4_ACTION_DESCRIPTORS[swapAction], param).swap
  } catch {
    // not an error: the parameters are not in the original layout, so the new one is used. When
    // they are not in the new one either, the decoding below throws.
  }
  return extractParams(V4_SWAP_ACTION_DESCRIPTORS_WITH_MIN_HOP_PRICE[swapAction], param).swap
}

// The native token is always paid from the ETH that the router holds
const getV4Payer = (currency: string, isUser: boolean): Place =>
  isUser && currency.toLowerCase() !== NATIVE_TOKEN ? USER : ROUTER

// the V4 router has the open delta (0) to say "all that is owed" or "all that is due"
const OPEN_DELTA = 0n

/**
 * The V4 pool manager keeps what every swap owes or is due, and the calls that settle and take
 * move the tokens in and out. It reverts when a call ends with tokens that are not settled, so it
 * never keeps tokens of the signer.
 */
const decodeV4Actions = (
  actions: string,
  params: readonly Hex[],
  ctx: UniswapContext,
  pools: Set<string>
): Effect[] => {
  const parsedActions = parseCommands(actions)
  if (!parsedActions || parsedActions.length !== params.length) {
    return [getOpaqueEffect('V4 actions that do not match', ctx, 'Unknown Uniswap V4 action')]
  }

  // What the swaps of this command owe to the pool manager, by currency. A settle of "all that is
  // owed" pays exactly this amount. It is not known (null) when the currency is also the output
  // of a swap, because what a swap returns is not known.
  const owed = new Map<string, bigint | null>()
  // the currencies that a swap of this command returns
  const credited = new Set<string>()
  const addOwed = (currency: string, amount: bigint | null) => {
    const previous = owed.get(currency)
    owed.set(currency, amount === null || previous === null ? null : (previous ?? 0n) + amount)
  }
  const addCredit = (currency: string) => {
    if (owed.has(currency)) owed.set(currency, null)
    credited.add(currency)
  }
  const settleAllOwed = (currency: string): Amount => {
    const amount = owed.get(currency)
    owed.set(currency, credited.has(currency) ? null : 0n)
    return amount === undefined || amount === null ? UNKNOWN : exact(amount)
  }
  const settle = (currency: string, payer: Place, amount: Amount): Effect => ({
    type: 'transfer',
    token: currency.toLowerCase(),
    from: payer,
    to: V4,
    amount
  })
  const swapEffects = (tokenIn: string, tokenOut: string, amountIn: bigint | null): Effect[] => {
    const input = tokenIn.toLowerCase()
    // what an earlier swap returns is not known, so the currency is owed in an unknown amount
    addOwed(input, credited.has(input) ? null : amountIn)
    addCredit(tokenOut.toLowerCase())
    return [getV4Swap(tokenIn, tokenOut)]
  }

  return parsedActions.flatMap((action, index): Effect[] => {
    const param = params[index]!
    const place = (address: string) => getPlace(address, ctx, pools)
    try {
      if (action === V4_ACTION_CODES.SETTLE) {
        const args = extractParams(V4_ACTION_DESCRIPTORS.SETTLE, param)
        const currency = args.currency.toLowerCase()
        let amount: Amount
        if (args.amount === OPEN_DELTA) amount = settleAllOwed(currency)
        else {
          amount = toAmount(args.amount)
          // what is left to pay is not known after a payment of another amount
          owed.set(currency, null)
        }
        return [settle(currency, getV4Payer(currency, args.payerIsUser), amount)]
      }
      if (action === V4_ACTION_CODES.SETTLE_ALL) {
        const args = extractParams(V4_ACTION_DESCRIPTORS.SETTLE_ALL, param)
        const currency = args.currency.toLowerCase()
        return [settle(currency, getV4Payer(currency, true), settleAllOwed(currency))]
      }
      if (action === V4_ACTION_CODES.SETTLE_PAIR) {
        const args = extractParams(V4_ACTION_DESCRIPTORS.SETTLE_PAIR, param)
        return [args.currency0, args.currency1].map((currency: string): Effect => {
          const lowerCaseCurrency = currency.toLowerCase()
          return settle(
            lowerCaseCurrency,
            getV4Payer(lowerCaseCurrency, true),
            settleAllOwed(lowerCaseCurrency)
          )
        })
      }
      if (action === V4_ACTION_CODES.TAKE) {
        const args = extractParams(V4_ACTION_DESCRIPTORS.TAKE, param)
        return [
          {
            type: 'transfer',
            token: args.currency.toLowerCase(),
            from: V4,
            to: place(args.recipient),
            amount: args.amount === OPEN_DELTA ? ALL : exact(args.amount)
          }
        ]
      }
      if (action === V4_ACTION_CODES.TAKE_ALL) {
        const args = extractParams(V4_ACTION_DESCRIPTORS.TAKE_ALL, param)
        return [
          { type: 'transfer', token: args.currency.toLowerCase(), from: V4, to: USER, amount: ALL }
        ]
      }
      if (action === V4_ACTION_CODES.TAKE_PORTION) {
        const args = extractParams(V4_ACTION_DESCRIPTORS.TAKE_PORTION, param)
        return [
          {
            type: 'transfer',
            token: args.currency.toLowerCase(),
            from: V4,
            to: place(args.recipient),
            amount: portion(args.bips)
          }
        ]
      }
      if (action === V4_ACTION_CODES.TAKE_PAIR) {
        const args = extractParams(V4_ACTION_DESCRIPTORS.TAKE_PAIR, param)
        return [args.currency0, args.currency1].map(
          (currency: string): Effect => ({
            type: 'transfer',
            token: currency.toLowerCase(),
            from: V4,
            to: place(args.recipient),
            amount: ALL
          })
        )
      }
      if (action === V4_ACTION_CODES.CLOSE_CURRENCY) {
        const args = extractParams(V4_ACTION_DESCRIPTORS.CLOSE_CURRENCY, param)
        const token = args.currency.toLowerCase()
        // it settles what is owed or takes what is due, so both are possible
        return [
          settle(token, getV4Payer(token, true), settleAllOwed(token)),
          { type: 'transfer', token, from: V4, to: USER, amount: ALL }
        ]
      }
      if (action === V4_ACTION_CODES.SWEEP) {
        const args = extractParams(V4_ACTION_DESCRIPTORS.SWEEP, param)
        return [
          {
            type: 'transfer',
            token: args.currency.toLowerCase(),
            from: ROUTER,
            to: place(args.recipient),
            amount: ALL
          }
        ]
      }
      if (action === V4_ACTION_CODES.SWAP_EXACT_IN_SINGLE) {
        const swap = extractV4SwapParams('SWAP_EXACT_IN_SINGLE', param)
        const [poolKey, zeroForOne] = swap
        const [currency0, currency1] = poolKey
        const [tokenIn, tokenOut] = zeroForOne ? [currency0, currency1] : [currency1, currency0]
        return swapEffects(tokenIn, tokenOut, getV4AmountIn(swap))
      }
      if (action === V4_ACTION_CODES.SWAP_EXACT_OUT_SINGLE) {
        const [poolKey, zeroForOne] = extractV4SwapParams('SWAP_EXACT_OUT_SINGLE', param)
        const [currency0, currency1] = poolKey
        const [tokenIn, tokenOut] = zeroForOne ? [currency0, currency1] : [currency1, currency0]
        // what an exact output swap owes is not known: only the most it can owe is
        return swapEffects(tokenIn, tokenOut, null)
      }
      if (action === V4_ACTION_CODES.SWAP_EXACT_IN) {
        const swap = extractV4SwapParams('SWAP_EXACT_IN', param)
        const [tokenIn, path] = swap
        if (!path.length) throw new Error('V4 swap without a path')
        return swapEffects(tokenIn, path[path.length - 1][0], getV4AmountIn(swap))
      }
      if (action === V4_ACTION_CODES.SWAP_EXACT_OUT) {
        const [tokenOut, path] = extractV4SwapParams('SWAP_EXACT_OUT', param)
        if (!path.length) throw new Error('V4 swap without a path')
        return swapEffects(path[0][0], tokenOut, null)
      }
    } catch {
      // the action does not decode, so it is shown as an action that is not understood
      return [
        getOpaqueEffect(`V4 action ${action} does not decode`, ctx, 'Unknown Uniswap V4 action')
      ]
    }
    return [getOpaqueEffect(`V4 action ${action}`, ctx, 'Unknown Uniswap V4 action')]
  })
}

// The amount that an exact input swap pays, or null when it is all that is owed (the open delta).
// `amountIn` has the same name in the two layouts of the swap parameters.
const getV4AmountIn = (swap: any): bigint | null =>
  swap.amountIn === OPEN_DELTA ? null : swap.amountIn

const getV4Swap = (tokenIn: string, tokenOut: string): Effect => ({
  type: 'convert',
  kind: 'swap',
  tokenIn: tokenIn.toLowerCase(),
  tokenOut: tokenOut.toLowerCase(),
  from: V4,
  to: V4,
  amountIn: UNKNOWN
})

/**
 * Turns the commands of a Universal Router call into effects. A command that is not understood, or
 * that does not decode, is an `opaque` effect.
 */
export const decodeUniversalRouter = (
  commands: Hex,
  inputs: readonly Hex[],
  ctx: UniswapContext,
  // what happens before the commands, for a contract that calls the router (SwapProxy)
  effectsBefore: Effect[] = []
): Effect[] => {
  const parsedCommands = parseCommands(commands)
  if (!parsedCommands || parsedCommands.length !== inputs.length) {
    return [getOpaqueEffect('commands that do not match the inputs', ctx)]
  }

  const pools = getPrepaidPools(parsedCommands, inputs, ctx)
  const place = (address: string) => getPlace(address, ctx, pools)
  const effects: Effect[] = [...effectsBefore]

  // the value of the transaction goes to the router. This is where the ETH of a swap comes from.
  if (ctx.callValue > 0n) {
    effects.push({
      type: 'transfer',
      token: NATIVE_TOKEN,
      from: USER,
      to: ROUTER,
      amount: exact(ctx.callValue),
      isCallValue: true
    })
  }

  parsedCommands.forEach((command, index) => {
    const input = inputs[index]!
    try {
      if (command === COMMANDS.V3_SWAP_EXACT_IN || command === COMMANDS.V3_SWAP_EXACT_OUT) {
        const isExactIn = command === COMMANDS.V3_SWAP_EXACT_IN
        const { inputsDetails } = isExactIn
          ? COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_IN
          : COMMANDS_DESCRIPTIONS.V3_SWAP_EXACT_OUT
        const params = extractParams(inputsDetails, input)
        const path = parsePath(params.path)
        if (!path.length) throw new Error('V3 swap without a path')

        // the path of an exact out swap is in the order of the output
        const [tokenIn, tokenOut] = isExactIn
          ? [path[0]!, path[path.length - 1]!]
          : [path[path.length - 1]!, path[0]!]
        effects.push({
          type: 'convert',
          kind: 'swap',
          tokenIn: tokenIn.toLowerCase(),
          tokenOut: tokenOut.toLowerCase(),
          from: params.payerIsUser ? USER : ROUTER,
          to: place(params.recipient),
          amountIn: isExactIn ? toAmount(params.amountIn) : UNKNOWN
        })
        return
      }

      if (command === COMMANDS.V2_SWAP_EXACT_IN) {
        const swap = decodeV2SwapExactIn(input, ctx)
        if (!swap || swap.tokens.length < 2) throw new Error('V2 swap that does not decode')

        let from: Place = swap.payerIsUser ? USER : ROUTER
        // a swap that is paid by its pool is not paid by the signer or the router
        if (isPrepaidV2Swap(swap)) {
          from = swap.pool
            ? { kind: 'pool', address: swap.pool }
            : { kind: 'external', address: 'unverified pool' }
        }
        effects.push({
          type: 'convert',
          kind: 'swap',
          tokenIn: swap.tokens[0]!,
          tokenOut: swap.tokens[swap.tokens.length - 1]!,
          from,
          to: place(swap.recipient),
          amountIn: isPrepaidV2Swap(swap) ? ALL : toAmount(swap.amountIn)
        })
        return
      }

      if (command === COMMANDS.V2_SWAP_EXACT_OUT) {
        const params = extractParams(COMMANDS_DESCRIPTIONS.V2_SWAP_EXACT_OUT.inputsDetails, input)
        const path: string[] = params.path
        if (path.length < 2) throw new Error('V2 swap without a path')
        effects.push({
          type: 'convert',
          kind: 'swap',
          tokenIn: path[0]!.toLowerCase(),
          tokenOut: path[path.length - 1]!.toLowerCase(),
          from: params.payerIsUser ? USER : ROUTER,
          to: place(params.recipient),
          amountIn: UNKNOWN
        })
        return
      }

      if (command === COMMANDS.PERMIT2_TRANSFER_FROM) {
        const params = extractParams(
          COMMANDS_DESCRIPTIONS.PERMIT2_TRANSFER_FROM.inputsDetails,
          input
        )
        effects.push({
          type: 'transfer',
          token: params.token.toLowerCase(),
          from: USER,
          to: place(params.recipient),
          amount: exact(params.amount)
        })
        return
      }

      if (command === COMMANDS.SWEEP) {
        const params = extractParams(COMMANDS_DESCRIPTIONS.SWEEP.inputsDetails, input)
        // it sends everything that the router holds, the amount is only the least that it must be
        effects.push({
          type: 'transfer',
          token: params.token.toLowerCase(),
          from: ROUTER,
          to: place(params.recipient),
          amount: ALL
        })
        return
      }

      if (command === COMMANDS.TRANSFER) {
        const params = extractParams(COMMANDS_DESCRIPTIONS.TRANSFER.inputsDetails, input)
        effects.push({
          type: 'transfer',
          token: params.token.toLowerCase(),
          from: ROUTER,
          to: place(params.recipient),
          amount: toAmount(params.value)
        })
        return
      }

      if (command === COMMANDS.PAY_PORTION) {
        const params = extractParams(COMMANDS_DESCRIPTIONS.PAY_PORTION.inputsDetails, input)
        effects.push({
          type: 'transfer',
          token: params.token.toLowerCase(),
          from: ROUTER,
          to: place(params.recipient),
          amount: portion(params.bips)
        })
        return
      }

      if (command === COMMANDS.WRAP_ETH || command === COMMANDS.UNWRAP_WETH) {
        if (!ctx.wrappedNative)
          throw new Error('the wrapped native token of the network is unknown')
        const isWrap = command === COMMANDS.WRAP_ETH
        const params = extractParams(
          isWrap
            ? COMMANDS_DESCRIPTIONS.WRAP_ETH.inputsDetails
            : COMMANDS_DESCRIPTIONS.UNWRAP_WETH.inputsDetails,
          input
        )
        effects.push({
          type: 'convert',
          kind: isWrap ? 'wrap' : 'unwrap',
          tokenIn: isWrap ? NATIVE_TOKEN : ctx.wrappedNative,
          tokenOut: isWrap ? ctx.wrappedNative : NATIVE_TOKEN,
          from: ROUTER,
          to: place(params.recipient),
          // a wrap takes the amount of the command, an unwrap takes all the wrapped tokens
          amountIn: isWrap ? toAmount(params.amountMin) : ALL
        })
        return
      }

      if (command === COMMANDS.PERMIT2_PERMIT) {
        const {
          permit: {
            details: { token, amount },
            spender
          }
        } = extractParams(COMMANDS_DESCRIPTIONS.PERMIT2_PERMIT.inputsDetails, input)
        effects.push({
          type: 'permit',
          token: token.toLowerCase(),
          spender: spender.toLowerCase(),
          amount
        })
        return
      }

      if (command === COMMANDS.BALANCE_CHECK_ERC20) {
        // it only reverts when a balance is too low and moves no tokens
        extractParams(COMMANDS_DESCRIPTIONS.BALANCE_CHECK_ERC20.inputsDetails, input)
        return
      }

      if (command === COMMANDS.V4_SWAP) {
        const params = extractParams(COMMANDS_DESCRIPTIONS.V4_SWAP.inputsDetails, input)
        effects.push(...decodeV4Actions(params.actions, params.params, ctx, pools))
        return
      }

      effects.push(getOpaqueEffect(`command ${command}`, ctx))
    } catch {
      // The command does not decode. It is shown as an action that is not understood, which also
      // stops the summary from being shortened.
      effects.push(getOpaqueEffect(`command ${command} does not decode`, ctx))
    }
  })

  return effects
}
