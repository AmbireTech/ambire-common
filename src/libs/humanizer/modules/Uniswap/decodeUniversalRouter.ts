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
  ALL,
  Amount,
  Effect,
  NATIVE_TOKEN,
  Place,
  RecipientRules,
  ROUTER,
  UNKNOWN,
  USER,
  UniswapContext,
  V4,
  convert,
  exact,
  getPlace,
  portion,
  toAmount,
  transfer
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

// the Universal Router reads 1 and 2 as the caller and itself, and the pools that its commands pay
const UR_RECIPIENT_RULES = (pools: Set<string>): RecipientRules => ({
  hasConstants: true,
  isZeroTheRouter: false,
  pools
})

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

// the tokens of a V4 pool swap, in the order of the swap
const getPoolSwapTokens = (poolKey: string[], zeroForOne: boolean): [string, string] =>
  zeroForOne ? [poolKey[0]!, poolKey[1]!] : [poolKey[1]!, poolKey[0]!]

// The amount that an exact input swap pays, or null when it is all that is owed (the open delta).
// `amountIn` has the same name in the two layouts of the swap parameters.
const getV4AmountIn = (swap: any): bigint | null =>
  swap.amountIn === OPEN_DELTA ? null : swap.amountIn

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

  const place = (address: string) => getPlace(address, ctx, UR_RECIPIENT_RULES(pools))
  const decode = (name: keyof typeof V4_ACTION_DESCRIPTORS, param: Hex) =>
    extractParams(V4_ACTION_DESCRIPTORS[name], param)

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
  const settle = (currency: string, payer: Place, amount: Amount) =>
    transfer(currency, payer, V4, amount)
  const settleAll = (currency: string) => {
    const token = currency.toLowerCase()
    return settle(token, getV4Payer(token, true), settleAllOwed(token))
  }
  const take = (currency: string, to: Place, amount: Amount) => transfer(currency, V4, to, amount)
  const swap = (tokenIn: string, tokenOut: string, amountIn: bigint | null): Effect[] => {
    const input = tokenIn.toLowerCase()
    // what an earlier swap returns is not known, so the currency is owed in an unknown amount
    addOwed(input, credited.has(input) ? null : amountIn)
    addCredit(tokenOut.toLowerCase())
    return [convert('swap', tokenIn, tokenOut, V4, V4, UNKNOWN)]
  }

  const handlers: { [action: string]: (param: Hex) => Effect[] } = {
    [V4_ACTION_CODES.SETTLE]: (param) => {
      const args = decode('SETTLE', param)
      const currency = args.currency.toLowerCase()
      let amount: Amount
      if (args.amount === OPEN_DELTA) amount = settleAllOwed(currency)
      else {
        amount = toAmount(args.amount)
        // what is left to pay is not known after a payment of another amount
        owed.set(currency, null)
      }
      return [settle(currency, getV4Payer(currency, args.payerIsUser), amount)]
    },
    [V4_ACTION_CODES.SETTLE_ALL]: (param) => [settleAll(decode('SETTLE_ALL', param).currency)],
    [V4_ACTION_CODES.SETTLE_PAIR]: (param) => {
      const args = decode('SETTLE_PAIR', param)
      return [settleAll(args.currency0), settleAll(args.currency1)]
    },
    [V4_ACTION_CODES.TAKE]: (param) => {
      const args = decode('TAKE', param)
      const amount = args.amount === OPEN_DELTA ? ALL : exact(args.amount)
      return [take(args.currency, place(args.recipient), amount)]
    },
    [V4_ACTION_CODES.TAKE_ALL]: (param) => [take(decode('TAKE_ALL', param).currency, USER, ALL)],
    [V4_ACTION_CODES.TAKE_PORTION]: (param) => {
      const args = decode('TAKE_PORTION', param)
      return [take(args.currency, place(args.recipient), portion(args.bips))]
    },
    [V4_ACTION_CODES.TAKE_PAIR]: (param) => {
      const args = decode('TAKE_PAIR', param)
      return [args.currency0, args.currency1].map((currency: string) =>
        take(currency, place(args.recipient), ALL)
      )
    },
    // it settles what is owed or takes what is due, so both are possible
    [V4_ACTION_CODES.CLOSE_CURRENCY]: (param) => {
      const { currency } = decode('CLOSE_CURRENCY', param)
      return [settleAll(currency), take(currency, USER, ALL)]
    },
    [V4_ACTION_CODES.SWEEP]: (param) => {
      const args = decode('SWEEP', param)
      return [transfer(args.currency, ROUTER, place(args.recipient), ALL)]
    },
    [V4_ACTION_CODES.SWAP_EXACT_IN_SINGLE]: (param) => {
      const params = extractV4SwapParams('SWAP_EXACT_IN_SINGLE', param)
      const [tokenIn, tokenOut] = getPoolSwapTokens(params[0], params[1])
      return swap(tokenIn, tokenOut, getV4AmountIn(params))
    },
    // what an exact output swap owes is not known: only the most it can owe is
    [V4_ACTION_CODES.SWAP_EXACT_OUT_SINGLE]: (param) => {
      const params = extractV4SwapParams('SWAP_EXACT_OUT_SINGLE', param)
      const [tokenIn, tokenOut] = getPoolSwapTokens(params[0], params[1])
      return swap(tokenIn, tokenOut, null)
    },
    [V4_ACTION_CODES.SWAP_EXACT_IN]: (param) => {
      const params = extractV4SwapParams('SWAP_EXACT_IN', param)
      const [tokenIn, path] = params
      if (!path.length) throw new Error('V4 swap without a path')
      return swap(tokenIn, path[path.length - 1][0], getV4AmountIn(params))
    },
    [V4_ACTION_CODES.SWAP_EXACT_OUT]: (param) => {
      const [tokenOut, path] = extractV4SwapParams('SWAP_EXACT_OUT', param)
      if (!path.length) throw new Error('V4 swap without a path')
      return swap(path[0][0], tokenOut, null)
    }
  }

  return parsedActions.flatMap((action, index): Effect[] => {
    const handler = handlers[action]
    if (!handler) {
      return [getOpaqueEffect(`V4 action ${action}`, ctx, 'Unknown Uniswap V4 action')]
    }
    try {
      return handler(params[index]!)
    } catch {
      // the action does not decode, so it is shown as an action that is not understood
      return [
        getOpaqueEffect(`V4 action ${action} does not decode`, ctx, 'Unknown Uniswap V4 action')
      ]
    }
  })
}

type CommandEnv = { ctx: UniswapContext; pools: Set<string>; place: (address: string) => Place }

const decodeInput = (name: keyof typeof COMMANDS_DESCRIPTIONS, input: Hex) =>
  extractParams(COMMANDS_DESCRIPTIONS[name].inputsDetails, input)

// The swaps of V3: the path of an exact output swap is in the order of the output
const decodeV3Swap =
  (isExactIn: boolean) =>
  (input: Hex, { place }: CommandEnv): Effect[] => {
    const params = decodeInput(isExactIn ? 'V3_SWAP_EXACT_IN' : 'V3_SWAP_EXACT_OUT', input)
    const path = parsePath(params.path)
    if (!path.length) throw new Error('V3 swap without a path')

    const [tokenIn, tokenOut] = isExactIn
      ? [path[0]!, path[path.length - 1]!]
      : [path[path.length - 1]!, path[0]!]
    return [
      convert(
        'swap',
        tokenIn,
        tokenOut,
        params.payerIsUser ? USER : ROUTER,
        place(params.recipient),
        isExactIn ? toAmount(params.amountIn) : UNKNOWN
      )
    ]
  }

// The commands that send tokens of the router: SWEEP sends everything that the router holds (the
// amount of the command is only the least that it must be), TRANSFER sends an amount and
// PAY_PORTION sends a share
const decodeRouterPayment =
  (name: 'SWEEP' | 'TRANSFER' | 'PAY_PORTION', getAmount: (params: any) => Amount) =>
  (input: Hex, { place }: CommandEnv): Effect[] => {
    const params = decodeInput(name, input)
    return [transfer(params.token, ROUTER, place(params.recipient), getAmount(params))]
  }

// A wrap takes the amount of the command, an unwrap takes all the wrapped tokens
const decodeWrapping =
  (isWrap: boolean) =>
  (input: Hex, { ctx, place }: CommandEnv): Effect[] => {
    if (!ctx.wrappedNative) throw new Error('the wrapped native token of the network is unknown')
    const params = decodeInput(isWrap ? 'WRAP_ETH' : 'UNWRAP_WETH', input)
    return [
      convert(
        isWrap ? 'wrap' : 'unwrap',
        isWrap ? NATIVE_TOKEN : ctx.wrappedNative,
        isWrap ? ctx.wrappedNative : NATIVE_TOKEN,
        ROUTER,
        place(params.recipient),
        isWrap ? toAmount(params.amountMin) : ALL
      )
    ]
  }

const COMMAND_DECODERS: { [command: string]: (input: Hex, env: CommandEnv) => Effect[] } = {
  [COMMANDS.V3_SWAP_EXACT_IN]: decodeV3Swap(true),
  [COMMANDS.V3_SWAP_EXACT_OUT]: decodeV3Swap(false),
  [COMMANDS.V2_SWAP_EXACT_IN]: (input, { ctx, place }) => {
    const swap = decodeV2SwapExactIn(input, ctx)
    if (!swap || swap.tokens.length < 2) throw new Error('V2 swap that does not decode')

    // a swap that is paid by its pool is not paid by the signer or the router
    const isPrepaid = isPrepaidV2Swap(swap)
    let from: Place = swap.payerIsUser ? USER : ROUTER
    if (isPrepaid) {
      from = swap.pool
        ? { kind: 'pool', address: swap.pool }
        : { kind: 'external', address: 'unverified pool' }
    }
    return [
      convert(
        'swap',
        swap.tokens[0]!,
        swap.tokens[swap.tokens.length - 1]!,
        from,
        place(swap.recipient),
        isPrepaid ? ALL : toAmount(swap.amountIn)
      )
    ]
  },
  [COMMANDS.V2_SWAP_EXACT_OUT]: (input, { place }) => {
    const params = decodeInput('V2_SWAP_EXACT_OUT', input)
    const path: string[] = params.path
    if (path.length < 2) throw new Error('V2 swap without a path')
    return [
      convert(
        'swap',
        path[0]!,
        path[path.length - 1]!,
        params.payerIsUser ? USER : ROUTER,
        place(params.recipient),
        UNKNOWN
      )
    ]
  },
  [COMMANDS.PERMIT2_TRANSFER_FROM]: (input, { place }) => {
    const params = decodeInput('PERMIT2_TRANSFER_FROM', input)
    return [transfer(params.token, USER, place(params.recipient), exact(params.amount))]
  },
  [COMMANDS.SWEEP]: decodeRouterPayment('SWEEP', () => ALL),
  [COMMANDS.TRANSFER]: decodeRouterPayment('TRANSFER', (params) => toAmount(params.value)),
  [COMMANDS.PAY_PORTION]: decodeRouterPayment('PAY_PORTION', (params) => portion(params.bips)),
  [COMMANDS.WRAP_ETH]: decodeWrapping(true),
  [COMMANDS.UNWRAP_WETH]: decodeWrapping(false),
  [COMMANDS.PERMIT2_PERMIT]: (input) => {
    const {
      permit: {
        details: { token, amount },
        spender
      }
    } = decodeInput('PERMIT2_PERMIT', input)
    return [{ type: 'permit', token: token.toLowerCase(), spender: spender.toLowerCase(), amount }]
  },
  [COMMANDS.BALANCE_CHECK_ERC20]: (input) => {
    // it only reverts when a balance is too low and moves no tokens
    decodeInput('BALANCE_CHECK_ERC20', input)
    return []
  },
  [COMMANDS.V4_SWAP]: (input, { ctx, pools }) => {
    const params = decodeInput('V4_SWAP', input)
    return decodeV4Actions(params.actions, params.params, ctx, pools)
  }
}

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
  const env: CommandEnv = {
    ctx,
    pools,
    place: (address) => getPlace(address, ctx, UR_RECIPIENT_RULES(pools))
  }

  return [
    ...effectsBefore,
    // the value of the transaction goes to the router. This is where the ETH of a swap comes from.
    ...(ctx.callValue > 0n ? [transfer(NATIVE_TOKEN, USER, ROUTER, exact(ctx.callValue))] : []),
    ...parsedCommands.flatMap((command, index): Effect[] => {
      const decoder = COMMAND_DECODERS[command]
      if (!decoder) return [getOpaqueEffect(`command ${command}`, ctx)]
      try {
        return decoder(inputs[index]!, env)
      } catch {
        // The command does not decode. It is shown as an action that is not understood, which also
        // stops the summary from being shortened.
        return [getOpaqueEffect(`command ${command} does not decode`, ctx)]
      }
    })
  ]
}
