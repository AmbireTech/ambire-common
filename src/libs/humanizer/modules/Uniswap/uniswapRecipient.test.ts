/**
 * Tests that the humanizer of the Uniswap routers shows what the signer pays and who receives it, in
 * every case, and that it never shortens a summary in a way that hides something.
 *
 * Every Universal Router call here is built with
 * `execute(bytes commands, bytes[] inputs, uint256 deadline)`. The same calldata can be opened in
 * https://transact.swiss-knife.xyz to inspect it.
 */
import { AbiCoder, getAddress, solidityPacked } from 'ethers'
import { encodeFunctionData, parseAbi } from 'viem'

import { expect } from '@jest/globals'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerVisualization, HumanizerWarning, IrCall } from '../../interfaces'
import { compareVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils'
import { uniswapHumanizer } from './'
import {
  COMMANDS,
  V4_ACTION_CODES,
  V4_ACTION_DESCRIPTORS,
  V4_SWAP_ACTION_DESCRIPTORS_WITH_MIN_HOP_PRICE
} from './Commands'
import { getAerodromePool } from './pools'
import { FUNDS_LEFT_IN_ROUTER_WARNING_CODE } from './render'

const coder = new AbiCoder()
const executeAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'
])
const router02Abi = parseAbi([
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])',
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function sweepToken(address token, uint256 amountMinimum, address recipient) payable',
  'function refundETH() payable'
])
const v2RouterAbi = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)'
])

const USER = '0xb674f3fd5f43464db0448a57529eaf37f04ccea5'
const ATTACKER = '0x1111111111111111111111111111111111111111'
const MSG_SENDER = '0x0000000000000000000000000000000000000001'
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002'
const UNISWAP_FEE_RECIPIENT = '0x000000fee13a103a10d593b9ae06b3e05f2e7e1c'
const ROUTER = '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af'
const BASE_ROUTER = '0x6Df1c91424F79E40E33B1A48F0687B666bE71075'
const ROUTER_02 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
const V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const NATIVE = '0x0000000000000000000000000000000000000000'
const DEADLINE = 9999999999n
// the Universal Router reads this number as "all the tokens that the router holds"
const ALL_TOKENS = 2n ** 255n

type Command = { id: string; input: string }

const v3Path = (tokens: string[]) =>
  solidityPacked(
    tokens.flatMap((_, i) => (i < tokens.length - 1 ? ['address', 'uint24'] : ['address'])),
    tokens.flatMap((token, i) => (i < tokens.length - 1 ? [token, 500] : [token]))
  )

const cmd = {
  v3In: (
    recipient: string,
    tokens = [USDC, WETH],
    payerIsUser = true,
    amountIn = 100n
  ): Command => ({
    id: COMMANDS.V3_SWAP_EXACT_IN,
    input: coder.encode(
      ['address', 'uint256', 'uint256', 'bytes', 'bool'],
      [recipient, amountIn, 1n, v3Path(tokens), payerIsUser]
    )
  }),
  v3Out: (recipient: string, tokens = [USDC, WETH]): Command => ({
    id: COMMANDS.V3_SWAP_EXACT_OUT,
    input: coder.encode(
      ['address', 'uint256', 'uint256', 'bytes', 'bool'],
      [recipient, 100n, 1n, v3Path(tokens), true]
    )
  }),
  v2In: (recipient: string, tokens = [USDC, WETH], payerIsUser = true): Command => ({
    id: COMMANDS.V2_SWAP_EXACT_IN,
    input: coder.encode(
      ['address', 'uint256', 'uint256', 'address[]', 'bool'],
      [recipient, 100n, 1n, tokens, payerIsUser]
    )
  }),
  v2Out: (recipient: string, tokens = [USDC, WETH]): Command => ({
    id: COMMANDS.V2_SWAP_EXACT_OUT,
    input: coder.encode(
      ['address', 'uint256', 'uint256', 'address[]', 'bool'],
      [recipient, 100n, 1n, tokens, true]
    )
  }),
  // the encoding of the routers that have an `isUni` flag
  altV2In: (
    recipient: string,
    tokens: string[],
    isUserPayer: boolean,
    amountIn = 100n,
    isUni = true
  ): Command => ({
    id: COMMANDS.V2_SWAP_EXACT_IN,
    input: coder.encode(
      ['address', 'uint256', 'uint256', 'bytes', 'bool', 'bool'],
      [
        recipient,
        amountIn,
        1n,
        // the tokens, with one byte (the pool type) after each token except the last
        solidityPacked(
          tokens.flatMap((_, i) => (i < tokens.length - 1 ? ['address', 'uint8'] : ['address'])),
          tokens.flatMap((token, i) => (i < tokens.length - 1 ? [token, 0] : [token]))
        ),
        isUserPayer,
        isUni
      ]
    )
  }),
  permit2TransferFrom: (recipient: string, token = USDC, amount = 100n): Command => ({
    id: COMMANDS.PERMIT2_TRANSFER_FROM,
    input: coder.encode(['address', 'address', 'uint160'], [token, recipient, amount])
  }),
  sweep: (recipient: string, token = USDC, amountMin = 1n): Command => ({
    id: COMMANDS.SWEEP,
    input: coder.encode(['address', 'address', 'uint160'], [token, recipient, amountMin])
  }),
  transfer: (recipient: string, token = USDC, value = 1n): Command => ({
    id: COMMANDS.TRANSFER,
    input: coder.encode(['address', 'address', 'uint256'], [token, recipient, value])
  }),
  payPortion: (recipient: string, bips: bigint, token = USDC): Command => ({
    id: COMMANDS.PAY_PORTION,
    input: coder.encode(['address', 'address', 'uint256'], [token, recipient, bips])
  }),
  wrap: (recipient: string, amount = 1n): Command => ({
    id: COMMANDS.WRAP_ETH,
    input: coder.encode(['address', 'uint256'], [recipient, amount])
  }),
  unwrap: (recipient: string, amountMin = 1n): Command => ({
    id: COMMANDS.UNWRAP_WETH,
    input: coder.encode(['address', 'uint256'], [recipient, amountMin])
  })
}

const poolKey = (currency0: string, currency1: string) => [currency0, currency1, 500, 10, NATIVE]
const types = (descriptors: { type: string }[]) => descriptors.map((d) => d.type)

const v4 = {
  settle: (currency = USDC, amount = 100n, payerIsUser = true) => ({
    action: V4_ACTION_CODES.SETTLE,
    param: coder.encode(
      V4_ACTION_DESCRIPTORS.SETTLE.map((d) => d.type),
      [currency, amount, payerIsUser]
    )
  }),
  settleAll: (currency = USDC, maxAmount = 1000n) => ({
    action: V4_ACTION_CODES.SETTLE_ALL,
    param: coder.encode(
      V4_ACTION_DESCRIPTORS.SETTLE_ALL.map((d) => d.type),
      [currency, maxAmount]
    )
  }),
  takeAll: (currency = WETH) => ({
    action: V4_ACTION_CODES.TAKE_ALL,
    param: coder.encode(
      V4_ACTION_DESCRIPTORS.TAKE_ALL.map((d) => d.type),
      [currency, 0n]
    )
  }),
  takePortion: (recipient: string, bips: bigint, currency = WETH) => ({
    action: V4_ACTION_CODES.TAKE_PORTION,
    param: coder.encode(
      V4_ACTION_DESCRIPTORS.TAKE_PORTION.map((d) => d.type),
      [currency, recipient, bips]
    )
  }),
  take: (recipient: string, currency = WETH, amount = 0n) => ({
    action: V4_ACTION_CODES.TAKE,
    param: coder.encode(
      V4_ACTION_DESCRIPTORS.TAKE.map((d) => d.type),
      [currency, recipient, amount]
    )
  }),
  // the original layout of the V4 router and the one with `minHopPriceX36`
  swapExactInSingle: (
    currency0 = USDC,
    currency1 = WETH,
    zeroForOne = true,
    withMinHopPrice = true
  ) => ({
    action: V4_ACTION_CODES.SWAP_EXACT_IN_SINGLE,
    param: withMinHopPrice
      ? coder.encode(types(V4_SWAP_ACTION_DESCRIPTORS_WITH_MIN_HOP_PRICE.SWAP_EXACT_IN_SINGLE), [
          [poolKey(currency0, currency1), zeroForOne, 100n, 1n, 0n, '0x']
        ])
      : coder.encode(types(V4_ACTION_DESCRIPTORS.SWAP_EXACT_IN_SINGLE), [
          [poolKey(currency0, currency1), zeroForOne, 100n, 1n, '0x']
        ])
  })
}

const v4Swap = (actions: { action: string; param: string }[]): Command => ({
  id: COMMANDS.V4_SWAP,
  input: coder.encode(
    ['bytes', 'bytes[]'],
    [`0x${actions.map(({ action }) => action.slice(2)).join('')}`, actions.map((a) => a.param)]
  )
})

type Options = { signer?: string; value?: bigint; chainId?: bigint; to?: string }

const run = (call: IrCall, { signer = USER, chainId = 1n }: Options = {}) =>
  uniswapHumanizer({ accountAddr: getAddress(signer), chainId } as unknown as AccountOp, call)

const buildCall = (commands: Command[], { value = 0n, to = ROUTER }: Options = {}): IrCall => ({
  to,
  value,
  data: encodeFunctionData({
    abi: executeAbi,
    functionName: 'execute',
    args: [
      `0x${commands.map(({ id }) => id.slice(2)).join('')}`,
      commands.map(({ input }) => input as `0x${string}`),
      DEADLINE
    ]
  })
})

const summarize = (commands: Command[], options: Options = {}) => {
  const humanized = run(buildCall(commands, options), options)
  return {
    visualization: humanized.fullVisualization || [],
    warnings: (humanized.warnings || []) as HumanizerWarning[]
  }
}

const humanize = (commands: Command[], options: Options = {}) =>
  summarize(commands, options).visualization

// The router that is called is in the line of an action that is not understood, it is not a recipient
const addressesOf = (visualization: HumanizerVisualization[]) =>
  visualization.flatMap((item) =>
    item.type === 'address' && item.address && item.address.toLowerCase() !== ROUTER.toLowerCase()
      ? [item.address.toLowerCase()]
      : []
  )

const labelsOf = (visualization: HumanizerVisualization[]) =>
  visualization.flatMap((item) =>
    item.type === 'action' || item.type === 'label' ? [item.content] : []
  )

const tokensOf = (visualization: HumanizerVisualization[]) =>
  visualization.flatMap((item) => (item.type === 'token' ? [item.address] : []))

const countSwaps = (visualization: HumanizerVisualization[]) =>
  labelsOf(visualization).filter((label) => label === 'Swap').length

const hasLeftoverWarning = (warnings: HumanizerWarning[]) =>
  warnings.some((warning) => warning.code === FUNDS_LEFT_IN_ROUTER_WARNING_CODE)

describe('Uniswap routers: what the signer pays and who receives it', () => {
  describe('swap commands', () => {
    const swapCommands: [string, (recipient: string) => Command][] = [
      ['V3_SWAP_EXACT_IN', (recipient) => cmd.v3In(recipient)],
      ['V3_SWAP_EXACT_OUT', (recipient) => cmd.v3Out(recipient)],
      ['V2_SWAP_EXACT_IN', (recipient) => cmd.v2In(recipient)],
      ['V2_SWAP_EXACT_OUT', (recipient) => cmd.v2Out(recipient)]
    ]

    test.each(swapCommands)('%s to another address shows that address', (_name, build) => {
      const swapItems = humanize([build(ATTACKER)]).filter((item) => item.type !== 'deadline')
      const [tokenIn, tokenOut] = swapItems.filter((item) => item.type === 'token')

      compareVisualizations(
        [
          getAction('Swap'),
          getToken(tokenIn!.address!, 0n),
          getLabel('for'),
          getToken(tokenOut!.address!, 0n),
          getLabel('and send it to'),
          getAddressVisualization(ATTACKER)
        ],
        swapItems
      )
    })

    test.each(swapCommands)('%s to the signer shows no recipient', (_name, build) => {
      ;[USER, getAddress(USER), MSG_SENDER].forEach((recipient) => {
        expect(addressesOf(humanize([build(recipient)]))).toEqual([])
      })
    })

    test.each(swapCommands)('%s to the router keeps the tokens in it', (_name, build) => {
      ;[ADDRESS_THIS, ROUTER].forEach((recipient) => {
        const { visualization, warnings } = summarize([build(recipient)])
        expect(addressesOf(visualization)).toEqual([])
        expect(hasLeftoverWarning(warnings)).toBe(true)
      })
    })

    test('a swap to the zero address is shown, as the tokens are lost', () => {
      expect(addressesOf(humanize([cmd.v3In(NATIVE)]))).toEqual([NATIVE])
    })
  })

  describe('who pays', () => {
    test('a swap that is paid by the signer after another swap is not hidden in it', () => {
      // the first swap gives WETH to the signer, and the second one spends WETH of the signer
      const visualization = humanize([
        cmd.v3In(MSG_SENDER, [USDC, WETH]),
        cmd.v3In(USER, [WETH, DAI])
      ])

      expect(countSwaps(visualization)).toBe(2)
      expect(tokensOf(visualization)).toEqual([USDC, WETH, WETH, DAI])
    })

    test('a swap that is paid by the router after another swap is one swap', () => {
      const { visualization, warnings } = summarize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.v3In(USER, [WETH, DAI], false, ALL_TOKENS)
      ])

      expect(countSwaps(visualization)).toBe(1)
      expect(tokensOf(visualization)).toEqual([USDC, DAI])
      expect(hasLeftoverWarning(warnings)).toBe(false)
    })

    test('a wrap of a small amount does not hide a swap that is paid with the WETH of the signer', () => {
      const { visualization, warnings } = summarize(
        [cmd.wrap(ADDRESS_THIS, 1n), cmd.v3In(USER, [WETH, DAI])],
        { value: 1n }
      )

      expect(labelsOf(visualization)).toContain('Wrap')
      expect(tokensOf(visualization)).toEqual([NATIVE, WETH, WETH, DAI])
      // the wrapped ETH stays in the router
      expect(hasLeftoverWarning(warnings)).toBe(true)
    })

    test('the ETH of the call that pays a swap is the only thing that is paid', () => {
      const { visualization, warnings } = summarize(
        [cmd.wrap(ADDRESS_THIS, 5n), cmd.v3In(USER, [WETH, DAI], false, 5n)],
        { value: 5n }
      )

      expect(tokensOf(visualization)).toEqual([NATIVE, DAI])
      expect(countSwaps(visualization)).toBe(1)
      expect(hasLeftoverWarning(warnings)).toBe(false)
    })
  })

  describe('pools of swaps that are made of many commands', () => {
    // Base: the first command sends its tokens to the pool of the second one, that swaps them
    const options = { chainId: 8453n, to: BASE_ROUTER }
    const pool = getAerodromePool(8453n, DAI, USDC, false)!

    test('the pool that the next command swaps is not a recipient', () => {
      const { visualization, warnings } = summarize(
        [cmd.v3In(pool, [WETH, DAI]), cmd.altV2In(USER, [DAI, USDC], false, 0n, false)],
        options
      )

      expect(addressesOf(visualization)).toEqual([])
      expect(countSwaps(visualization)).toBe(1)
      expect(tokensOf(visualization)).toEqual([WETH, USDC])
      expect(hasLeftoverWarning(warnings)).toBe(false)
    })

    test('an address that is not the pool of the next command is shown', () => {
      const visualization = humanize(
        [cmd.v3In(ATTACKER, [WETH, DAI]), cmd.altV2In(USER, [DAI, USDC], false, 0n, false)],
        options
      )

      expect(addressesOf(visualization)).toContain(ATTACKER)
    })

    test('the pool of other tokens is shown', () => {
      const visualization = humanize(
        [cmd.v3In(pool, [WETH, DAI]), cmd.altV2In(USER, [DAI, WETH], false, 0n, false)],
        options
      )

      expect(addressesOf(visualization)).toContain(pool)
    })

    test('a pool that no command swaps is shown as a recipient', () => {
      const visualization = humanize([cmd.v3In(pool, [WETH, DAI])], options)

      expect(addressesOf(visualization)).toEqual([pool])
    })
  })

  describe('other commands', () => {
    test('SWEEP of the tokens of the signer to another address is shown', () => {
      const visualization = humanize([
        cmd.permit2TransferFrom(ADDRESS_THIS, USDC, 100n),
        cmd.sweep(ATTACKER, USDC, 0n)
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization)).toEqual(['Send', 'to'])
    })

    test('TRANSFER of the tokens of the signer to another address is shown, also with a zero value', () => {
      const visualization = humanize([
        cmd.permit2TransferFrom(ADDRESS_THIS, USDC, 100n),
        cmd.transfer(ATTACKER, USDC, 0n),
        cmd.sweep(USER, USDC)
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('the tokens that the router already held are not the funds of the signer', () => {
      // no command of the call puts these tokens in the router
      expect(addressesOf(humanize([cmd.sweep(ATTACKER, USDC, 0n)]))).toEqual([ATTACKER])
      // they are shown only when nothing else is, and not as something that the signer pays
      expect(labelsOf(humanize([cmd.sweep(USER, USDC, 0n)]))).toEqual(['Withdraw'])
      expect(labelsOf(humanize([cmd.sweep(USER, USDC, 0n), cmd.v3In(USER)]))).toEqual([
        'Swap',
        'for'
      ])
    })

    test('UNWRAP_WETH for another address is shown, also with a zero minimum', () => {
      const visualization = humanize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.unwrap(ATTACKER, 0n)
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(tokensOf(visualization)).toEqual([USDC, NATIVE])
    })

    test('UNWRAP_WETH for the signer is part of the swap', () => {
      const { visualization, warnings } = summarize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.unwrap(USER, 0n)
      ])

      expect(addressesOf(visualization)).toEqual([])
      expect(tokensOf(visualization)).toEqual([USDC, NATIVE])
      expect(countSwaps(visualization)).toBe(1)
      expect(hasLeftoverWarning(warnings)).toBe(false)
    })

    test('WRAP_ETH for another address is shown', () => {
      const visualization = humanize([cmd.wrap(ATTACKER, 7n)], { value: 7n })

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization)).toContain('Wrap')
    })

    test('a wrap and an unwrap that send the ETH to another address are a transfer', () => {
      const visualization = humanize([cmd.wrap(ADDRESS_THIS, 7n), cmd.unwrap(ATTACKER, 0n)], {
        value: 7n
      })

      expect(labelsOf(visualization)).toEqual(['Send', 'to'])
      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('PERMIT2_TRANSFER_FROM to another address is shown', () => {
      const visualization = humanize([cmd.permit2TransferFrom(ATTACKER)])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization)).toEqual(['Send', 'to'])
    })

    describe('PAY_PORTION', () => {
      // the tokens of the signer go to the router, a part of them is paid to another address, and
      // all that is left goes back to the signer
      const withPortions = (...portions: bigint[]) =>
        humanize([
          cmd.permit2TransferFrom(ADDRESS_THIS, USDC, 1000n),
          ...portions.map((bips) => cmd.payPortion(ATTACKER, bips)),
          cmd.sweep(USER, USDC)
        ])

      test('a share of more than 1% is shown with its size', () => {
        const visualization = withPortions(10000n)

        expect(addressesOf(visualization)).toEqual([ATTACKER])
        expect(visualization.some((item) => item.content === '100%')).toBe(true)
        expect(addressesOf(withPortions(101n))).toEqual([ATTACKER])
      })

      test('an ordinary interface fee of up to 1% is not shown', () => {
        expect(addressesOf(withPortions(100n))).toEqual([])
        expect(addressesOf(withPortions(25n))).toEqual([])
      })

      test('many small shares that are more than 1% together are shown', () => {
        expect(addressesOf(withPortions(100n, 100n))).toEqual([ATTACKER])
        expect(addressesOf(withPortions(...Array(100).fill(100n)))).toEqual([ATTACKER])
      })

      test('a large share to the fee address of Uniswap is shown too', () => {
        const visualization = humanize([
          cmd.permit2TransferFrom(ADDRESS_THIS, USDC, 1000n),
          cmd.payPortion(UNISWAP_FEE_RECIPIENT, 10000n),
          cmd.sweep(USER, USDC)
        ])

        expect(addressesOf(visualization)).toEqual([UNISWAP_FEE_RECIPIENT])
      })

      test('a share to the signer is not shown', () => {
        const visualization = humanize([
          cmd.permit2TransferFrom(ADDRESS_THIS, USDC, 1000n),
          cmd.payPortion(USER, 10000n),
          cmd.sweep(USER, USDC)
        ])

        expect(addressesOf(visualization)).toEqual([])
      })
    })
  })

  describe('Uniswap V4', () => {
    const swapTo = (recipient: string, options: Options = {}) =>
      summarize(
        [
          v4Swap([
            v4.settle(USDC, 100n),
            v4.swapExactInSingle(USDC, DAI),
            v4.take(recipient, DAI, 0n)
          ])
        ],
        options
      )

    test('TAKE to another address is shown, also with the "all" amount (0)', () => {
      const { visualization } = swapTo(ATTACKER)

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(tokensOf(visualization)).toEqual([USDC, DAI])
    })

    test('TAKE to the signer shows no address', () => {
      ;[USER, getAddress(USER), MSG_SENDER].forEach((recipient) => {
        expect(addressesOf(swapTo(recipient).visualization)).toEqual([])
      })
      expect(countSwaps(swapTo(USER).visualization)).toBe(1)
    })

    test('TAKE to the router keeps the tokens in it', () => {
      expect(hasLeftoverWarning(swapTo(ADDRESS_THIS).warnings)).toBe(true)
    })

    test.each([true, false])(
      'a single swap is decoded (with minHopPriceX36: %s)',
      (withHopPrice) => {
        const visualization = humanize([
          v4Swap([
            v4.settle(USDC, 100n),
            v4.swapExactInSingle(USDC, DAI, true, withHopPrice),
            v4.take(USER, DAI)
          ])
        ])

        expect(tokensOf(visualization)).toEqual([USDC, DAI])
      }
    )

    test.each([true, false])(
      'a single swap against the order of the pool is paid in the other token (with minHopPriceX36: %s)',
      (withHopPrice) => {
        const visualization = humanize([
          v4Swap([
            v4.settle(DAI, 100n),
            v4.swapExactInSingle(USDC, DAI, false, withHopPrice),
            v4.take(USER, USDC)
          ])
        ])

        expect(tokensOf(visualization)).toEqual([DAI, USDC])
      }
    )

    test('the ETH of the call pays a settle of the native token', () => {
      const { visualization, warnings } = summarize(
        [
          v4Swap([
            v4.settle(NATIVE, 100n, false),
            v4.swapExactInSingle(NATIVE, USDC),
            v4.take(USER, USDC)
          ])
        ],
        { value: 100n }
      )

      expect(tokensOf(visualization)).toEqual([NATIVE, USDC])
      expect(hasLeftoverWarning(warnings)).toBe(false)
    })

    test('a settle of all that is owed pays the amount of the swap, so no ETH is left', () => {
      // the swap pays 100, as much as the call sends
      const { visualization, warnings } = summarize(
        [v4Swap([v4.swapExactInSingle(NATIVE, USDC), v4.settleAll(NATIVE), v4.takeAll(USDC)])],
        { value: 100n }
      )

      expect(tokensOf(visualization)).toEqual([NATIVE, USDC])
      expect(hasLeftoverWarning(warnings)).toBe(false)
    })

    test('a settle of all that is owed leaves the rest of the ETH of the call in the router', () => {
      const { warnings } = summarize(
        [v4Swap([v4.swapExactInSingle(NATIVE, USDC), v4.settleAll(NATIVE), v4.takeAll(USDC)])],
        { value: 250n }
      )

      expect(hasLeftoverWarning(warnings)).toBe(true)
    })

    test('a small fee that goes to the router is not reported, and a large one is', () => {
      const withFee = (bips: bigint) =>
        summarize(
          [
            v4Swap([
              v4.swapExactInSingle(NATIVE, USDC),
              v4.settleAll(NATIVE),
              v4.takePortion(ADDRESS_THIS, bips, USDC),
              v4.takeAll(USDC)
            ])
          ],
          { value: 100n }
        )

      expect(hasLeftoverWarning(withFee(25n).warnings)).toBe(false)
      expect(hasLeftoverWarning(withFee(5000n).warnings)).toBe(true)
    })

    test('ETH that the call sends and no command uses stays in the router', () => {
      const { warnings } = summarize(
        [
          v4Swap([
            v4.settle(NATIVE, 100n, false),
            v4.swapExactInSingle(NATIVE, USDC),
            v4.take(USER, USDC)
          ])
        ],
        { value: 150n }
      )

      expect(hasLeftoverWarning(warnings)).toBe(true)
    })
  })

  describe('a route that is split in many parts', () => {
    // ETH is paid in two ways: a part goes through USDC and the rest goes direct to USDT
    const splitRoute = (lastRecipient: string) => [
      cmd.wrap(ADDRESS_THIS, 5n),
      v4Swap([
        v4.settle(NATIVE, 5n, false),
        v4.swapExactInSingle(NATIVE, USDC),
        v4.take(ADDRESS_THIS, USDC, 0n)
      ]),
      cmd.v3In(ADDRESS_THIS, [WETH, USDC], false, 5n),
      cmd.v3In(lastRecipient, [WETH, USDT], false, ALL_TOKENS),
      v4Swap([
        v4.settle(USDC, ALL_TOKENS, false),
        v4.swapExactInSingle(USDC, USDT),
        v4.take(lastRecipient, USDT, 0n)
      ]),
      cmd.sweep(lastRecipient, USDT, 0n)
    ]

    test('is one swap from the token that is paid to the token that is received', () => {
      const { visualization, warnings } = summarize(splitRoute(USER), { value: 10n })

      expect(tokensOf(visualization)).toEqual([NATIVE, USDT])
      expect(labelsOf(visualization)).toEqual(['Swap', 'for'])
      expect(hasLeftoverWarning(warnings)).toBe(false)
    })

    test('shows the recipient when it is not the signer', () => {
      const visualization = humanize(splitRoute(ATTACKER), { value: 10n })

      // the sweep of the router sends USDT to the same address
      expect([...new Set(addressesOf(visualization))]).toEqual([ATTACKER])
      expect(tokensOf(visualization)).toContain(USDT)
    })

    test('swaps that are not connected are shown one by one', () => {
      const visualization = humanize([cmd.v3In(USER, [USDC, WETH]), cmd.v3In(USER, [DAI, USDT])])

      expect(countSwaps(visualization)).toBe(2)
    })
  })

  describe('commands that are not understood', () => {
    test('a command that is not understood stops the summary from being shortened', () => {
      const visualization = humanize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        { id: '0x21', input: '0x' },
        cmd.v3In(USER, [WETH, DAI], false, ALL_TOKENS)
      ])

      expect(countSwaps(visualization)).toBe(2)
      expect(labelsOf(visualization)).toContain('Uniswap action')
    })

    test('the ETH that the call sends is shown, because the extension shows it only when expanded', () => {
      const ethAmount = 5n * 10n ** 18n
      const visualization = humanize([{ id: '0x21', input: '0x' }], { value: ethAmount })
      const ethItem = visualization.find((item) => item.type === 'token' && item.address === NATIVE)

      expect(ethItem && 'value' in ethItem ? ethItem.value : undefined).toBe(ethAmount)
      expect(labelsOf(visualization)).toContain('Send')
    })

    test('a command that does not decode is not understood', () => {
      const visualization = humanize([cmd.v3In(ATTACKER), { id: COMMANDS.SWEEP, input: '0x1234' }])

      expect(addressesOf(visualization)).toContain(ATTACKER)
      expect(labelsOf(visualization)).toContain('Uniswap action')
    })

    test('a V4 action that is not understood is shown', () => {
      const visualization = humanize([
        v4Swap([
          v4.settle(USDC, 100n),
          { action: '0x14', param: '0x1234' },
          v4.take(ATTACKER, USDC, 0n)
        ])
      ])

      expect(labelsOf(visualization)).toContain('Unknown Uniswap V4 action')
      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('commands and inputs that do not match are not understood', () => {
      const attackerSwap = cmd.v3In(ATTACKER)
      const data = encodeFunctionData({
        abi: executeAbi,
        functionName: 'execute',
        args: [`0x${attackerSwap.id.slice(2)}00`, [attackerSwap.input as `0x${string}`], DEADLINE]
      })
      const visualization = run({ ...buildCall([attackerSwap]), data }).fullVisualization || []

      expect(labelsOf(visualization)).toEqual(['Uniswap action', 'to'])
    })
  })

  describe('networks', () => {
    test('a router that is not on the network of the account is not described', () => {
      // 0x66a9... is the Universal Router of Ethereum, it is not a router on Polygon
      const humanized = run(buildCall([cmd.v3In(ATTACKER)]), { chainId: 137n })

      expect(humanized.fullVisualization).toBeUndefined()
    })
  })

  describe('the older routers', () => {
    const multicall = (calls: `0x${string}`[], value = 0n): IrCall => ({
      to: ROUTER_02,
      value,
      data: encodeFunctionData({
        abi: router02Abi,
        functionName: 'multicall',
        args: [DEADLINE, calls]
      })
    })
    const exactInputSingle = (recipient: string, tokenIn = USDC, amountIn = 100n) =>
      encodeFunctionData({
        abi: router02Abi,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: tokenIn as `0x${string}`,
            tokenOut: DAI as `0x${string}`,
            fee: 500,
            recipient: recipient as `0x${string}`,
            amountIn,
            amountOutMinimum: 1n,
            sqrtPriceLimitX96: 0n
          }
        ]
      })
    const unwrapWETH9 = (recipient: string) =>
      encodeFunctionData({
        abi: router02Abi,
        functionName: 'unwrapWETH9',
        args: [0n, recipient as `0x${string}`]
      })
    const shown = (call: IrCall) => run(call).fullVisualization || []

    test('a swap to the router and an unwrap for another address show the address', () => {
      expect(
        addressesOf(shown(multicall([exactInputSingle(ADDRESS_THIS), unwrapWETH9(ATTACKER)])))
      ).toEqual([ATTACKER])
    })

    test('a swap to the router and an unwrap for the signer are one swap', () => {
      const visualization = shown(
        multicall([exactInputSingle(MSG_SENDER, WETH), unwrapWETH9(getAddress(USER))])
      )

      expect(addressesOf(visualization)).toEqual([])
    })

    test('a swap that is paid with the ETH of the call and a refund of the rest are one swap from ETH', () => {
      const visualization = shown(
        multicall(
          [
            exactInputSingle(MSG_SENDER, WETH, 100n),
            encodeFunctionData({ abi: router02Abi, functionName: 'refundETH' })
          ],
          100n
        )
      )

      expect(tokensOf(visualization)).toEqual([NATIVE, DAI])
      expect(countSwaps(visualization)).toBe(1)
    })

    test('a call in a multicall that is not understood is shown', () => {
      const visualization = shown(multicall([exactInputSingle(ATTACKER), '0xdeadbeef']))

      expect(labelsOf(visualization)).toContain('Uniswap action')
      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('a sweep of the router to another address is shown', () => {
      const visualization = shown(
        multicall([
          exactInputSingle(ADDRESS_THIS),
          encodeFunctionData({
            abi: router02Abi,
            functionName: 'sweepToken',
            args: [DAI as `0x${string}`, 0n, ATTACKER as `0x${string}`]
          })
        ])
      )

      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('a swap of the V2 router shows its recipient, and shows none for the signer', () => {
      const swapTo = (to: string) =>
        shown({
          to: V2_ROUTER,
          value: 0n,
          data: encodeFunctionData({
            abi: v2RouterAbi,
            functionName: 'swapExactTokensForTokens',
            args: [100n, 1n, [USDC, WETH] as `0x${string}`[], to as `0x${string}`, DEADLINE]
          })
        })

      expect(addressesOf(swapTo(ATTACKER))).toEqual([ATTACKER])
      expect(addressesOf(swapTo(getAddress(USER)))).toEqual([])
    })
  })
})
