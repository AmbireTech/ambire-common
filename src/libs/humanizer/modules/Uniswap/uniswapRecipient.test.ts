/**
 * Tests that the humanizer of the Uniswap Universal Router never hides the address that receives
 * the funds of a transaction.
 *
 * Every call here is built with `execute(bytes commands, bytes[] inputs, uint256 deadline)`.
 * The same calldata can be opened in https://transact.swiss-knife.xyz to inspect it.
 */
import { AbiCoder, getAddress, solidityPacked } from 'ethers'
import { encodeFunctionData, parseAbi } from 'viem'

import { expect } from '@jest/globals'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerVisualization, IrCall } from '../../interfaces'
import { compareVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils'
import { uniswapHumanizer } from './'
import {
  COMMANDS,
  V4_ACTION_CODES,
  V4_ACTION_DESCRIPTORS,
  V4_SWAP_ACTION_DESCRIPTORS_WITH_MIN_HOP_PRICE
} from './Commands'

const coder = new AbiCoder()
const executeAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'
])
const USER = '0xb674f3fd5f43464db0448a57529eaf37f04ccea5'
const ATTACKER = '0x1111111111111111111111111111111111111111'
const MSG_SENDER = '0x0000000000000000000000000000000000000001'
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002'
const UNISWAP_FEE_RECIPIENT = '0x000000fee13a103a10d593b9ae06b3e05f2e7e1c'
const ROUTER = '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const NATIVE = '0x0000000000000000000000000000000000000000'
const DEADLINE = 9999999999n

const accountOp = { accountAddr: getAddress(USER) } as unknown as AccountOp

type Command = { id: string; input: string }

const v3Path = (tokens: string[]) =>
  solidityPacked(
    tokens.flatMap((_, i) => (i < tokens.length - 1 ? ['address', 'uint24'] : ['address'])),
    tokens.flatMap((token, i) => (i < tokens.length - 1 ? [token, 500] : [token]))
  )

const cmd = {
  v3In: (recipient: string, tokens = [USDC, WETH]): Command => ({
    id: COMMANDS.V3_SWAP_EXACT_IN,
    input: coder.encode(
      ['address', 'uint256', 'uint256', 'bytes', 'bool'],
      [recipient, 100n, 1n, v3Path(tokens), true]
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
  altV2In: (recipient: string, tokens: string[], isUserPayer: boolean): Command => ({
    id: COMMANDS.V2_SWAP_EXACT_IN,
    input: coder.encode(
      ['address', 'uint256', 'uint256', 'bytes', 'bool', 'bool'],
      [
        recipient,
        100n,
        1n,
        // the tokens, with one byte (the pool type) after each token except the last
        solidityPacked(
          tokens.flatMap((_, i) => (i < tokens.length - 1 ? ['address', 'uint8'] : ['address'])),
          tokens.flatMap((token, i) => (i < tokens.length - 1 ? [token, 0] : [token]))
        ),
        isUserPayer,
        true
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
  wrap: (recipient: string, amountMin = 1n): Command => ({
    id: COMMANDS.WRAP_ETH,
    input: coder.encode(['address', 'uint256'], [recipient, amountMin])
  }),
  unwrap: (recipient: string, amountMin = 1n): Command => ({
    id: COMMANDS.UNWRAP_WETH,
    input: coder.encode(['address', 'uint256'], [recipient, amountMin])
  })
}

const v4 = {
  settle: (currency = USDC, amount = 100n) => ({
    action: V4_ACTION_CODES.SETTLE,
    param: coder.encode(
      V4_ACTION_DESCRIPTORS.SETTLE.map((d) => d.type),
      [currency, amount, true]
    )
  }),
  swapExactInSingle: (currency0 = USDC, currency1 = WETH) => ({
    action: V4_ACTION_CODES.SWAP_EXACT_IN_SINGLE,
    param: coder.encode(
      V4_ACTION_DESCRIPTORS.SWAP_EXACT_IN_SINGLE.map((d) => d.type),
      [[[currency0, currency1, 500, 10, NATIVE], true, 100n, 1n, '0x']]
    )
  }),
  take: (recipient: string, currency = WETH, amount = 0n) => ({
    action: V4_ACTION_CODES.TAKE,
    param: coder.encode(
      V4_ACTION_DESCRIPTORS.TAKE.map((d) => d.type),
      [currency, recipient, amount]
    )
  })
}

const v4Swap = (actions: { action: string; param: string }[]): Command => ({
  id: COMMANDS.V4_SWAP,
  input: coder.encode(
    ['bytes', 'bytes[]'],
    [`0x${actions.map(({ action }) => action.slice(2)).join('')}`, actions.map((a) => a.param)]
  )
})

const poolKey = (currency0: string, currency1: string) => [currency0, currency1, 500, 10, NATIVE]
const types = (descriptors: { type: string }[]) => descriptors.map((d) => d.type)

// the original layout of the V4 router and the one with `minHopPriceX36`
const singleSwap = (
  currency0: string,
  currency1: string,
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

const buildCall = (commands: Command[], to = ROUTER): IrCall => ({
  to,
  value: 0n,
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

const humanize = (commands: Command[], signer = USER): HumanizerVisualization[] => {
  const humanized = uniswapHumanizer(
    { ...accountOp, accountAddr: getAddress(signer) } as AccountOp,
    buildCall(commands)
  )
  return humanized.fullVisualization || []
}

const addressesOf = (visualization: HumanizerVisualization[]) =>
  visualization.flatMap((item) =>
    item.type === 'address' && item.address ? [item.address.toLowerCase()] : []
  )

const labelsOf = (visualization: HumanizerVisualization[]) =>
  visualization.flatMap((item) =>
    item.type === 'action' || item.type === 'label' ? [item.content] : []
  )

describe('Uniswap Universal Router: the recipient of the funds is shown', () => {
  const swapCommands: [string, (recipient: string) => Command][] = [
    ['V3_SWAP_EXACT_IN', (recipient) => cmd.v3In(recipient)],
    ['V3_SWAP_EXACT_OUT', (recipient) => cmd.v3Out(recipient)],
    ['V2_SWAP_EXACT_IN', (recipient) => cmd.v2In(recipient)],
    ['V2_SWAP_EXACT_OUT', (recipient) => cmd.v2Out(recipient)]
  ]

  describe('swap commands', () => {
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

    test.each(swapCommands)('%s to the signer or the router shows no recipient', (_name, build) => {
      ;[USER, getAddress(USER), MSG_SENDER, ADDRESS_THIS, ROUTER].forEach((recipient) => {
        expect(addressesOf(humanize([build(recipient)]))).toEqual([])
      })
    })

    test('a swap to the zero address is shown, as the tokens are lost', () => {
      expect(addressesOf(humanize([cmd.v3In(NATIVE)]))).toEqual([NATIVE])
    })
  })

  describe('alternative V2 swap encoding (routers with an isUni flag)', () => {
    test('the recipient of the last hop is shown', () => {
      expect(addressesOf(humanize([cmd.altV2In(ATTACKER, [USDC, WETH], true)]))).toEqual([ATTACKER])
    })

    test('the pool that receives the output of a hop paid by the router is not shown', () => {
      const pool = '0x328cc728dce83e80dbe55df9ba35baa6f1aa13a6'
      const visualization = humanize([
        cmd.v3In(pool, [WETH, DAI]),
        cmd.altV2In(USER, [DAI, USDC], false)
      ])

      expect(addressesOf(visualization)).toEqual([])
      expect(labelsOf(visualization).filter((label) => label === 'Swap')).toHaveLength(1)
    })

    test('the recipient of a hop that is followed by a hop paid by the signer is shown', () => {
      const visualization = humanize([
        cmd.v3In(ATTACKER, [WETH, DAI]),
        cmd.altV2In(USER, [DAI, USDC], true)
      ])

      expect(addressesOf(visualization)).toContain(ATTACKER)
    })
  })

  describe('other commands', () => {
    test('SWEEP to another address is shown, also with a zero minimum', () => {
      expect(addressesOf(humanize([cmd.sweep(ATTACKER, USDC, 0n)]))).toEqual([ATTACKER])
      expect(labelsOf(humanize([cmd.sweep(USER)]))).toContain('Take')
    })

    test('TRANSFER to another address is shown, also with a zero value', () => {
      expect(addressesOf(humanize([cmd.transfer(ATTACKER, USDC, 0n)]))).toEqual([ATTACKER])
    })

    test('UNWRAP_WETH for another address is shown, also with a zero minimum', () => {
      expect(addressesOf(humanize([cmd.unwrap(ATTACKER, 0n)]))).toEqual([ATTACKER])
      expect(humanize([cmd.unwrap(USER, 0n)])).toEqual([])
    })

    test('WRAP_ETH for another address is shown, for the router it is not', () => {
      expect(addressesOf(humanize([cmd.wrap(ATTACKER, 0n)]))).toEqual([ATTACKER])
      expect(addressesOf(humanize([cmd.wrap(ADDRESS_THIS, 5n)]))).toEqual([])
    })

    test('PERMIT2_TRANSFER_FROM to another address is shown', () => {
      expect(addressesOf(humanize([cmd.permit2TransferFrom(ATTACKER)]))).toEqual([ATTACKER])
    })

    test('PAY_PORTION is shown above 1%, but not a small fee or the fee collector of Uniswap', () => {
      expect(addressesOf(humanize([cmd.payPortion(ATTACKER, 10000n)]))).toEqual([ATTACKER])
      expect(addressesOf(humanize([cmd.payPortion(ATTACKER, 101n)]))).toEqual([ATTACKER])
      expect(humanize([cmd.payPortion(ATTACKER, 100n)])).toEqual([])
      expect(humanize([cmd.payPortion(UNISWAP_FEE_RECIPIENT, 10000n)])).toEqual([])
    })
  })

  describe('Uniswap V4', () => {
    test('TAKE to another address is shown, also with the "all" amount (0)', () => {
      const visualization = humanize([
        v4Swap([v4.settle(), v4.swapExactInSingle(), v4.take(ATTACKER, WETH, 0n)])
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('TAKE to the signer (any case) or the router shows no address', () => {
      ;[USER, getAddress(USER), ADDRESS_THIS, ROUTER].forEach((recipient) => {
        const visualization = humanize([
          v4Swap([v4.settle(), v4.swapExactInSingle(), v4.take(recipient, WETH, 42n)])
        ])
        expect(addressesOf(visualization)).toEqual([])
      })
    })
  })

  describe('merging of the summary (uniReduce)', () => {
    test('a swap to the router and an unwrap for the signer are merged into one swap', () => {
      const visualization = humanize([cmd.v3In(ADDRESS_THIS), cmd.unwrap(USER, 0n)])

      expect(addressesOf(visualization)).toEqual([])
      expect(labelsOf(visualization)).not.toContain('Unwrap')
    })

    test('an unwrap for another address is not merged into the swap', () => {
      const visualization = humanize([cmd.v3In(ADDRESS_THIS), cmd.unwrap(ATTACKER, 0n)])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization)).toContain('Unwrap')
    })

    test('a wrap for another address is not merged into the swap', () => {
      const visualization = humanize([cmd.wrap(ATTACKER, 7n), cmd.v3In(USER, [WETH, USDC])])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization)).toContain('Wrap')
    })

    test('swaps of the same tokens with different recipients are not merged', () => {
      const visualization = humanize([cmd.v3In(USER), cmd.v3In(ATTACKER)])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization).filter((label) => label === 'Swap')).toHaveLength(2)
    })

    test('swaps that follow each other are merged and keep the recipient of the last one', () => {
      const visualization = humanize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.v2In(ATTACKER, [WETH, DAI], false)
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization).filter((label) => label === 'Swap')).toHaveLength(1)
    })

    test('a transfer or a sweep to another address is not removed by a swap of the same token', () => {
      expect(
        addressesOf(humanize([cmd.transfer(ATTACKER, USDC, 1n), cmd.v3In(USER, [USDC, WETH])]))
      ).toEqual([ATTACKER])
      expect(
        addressesOf(humanize([cmd.v3In(ADDRESS_THIS, [USDC, WETH]), cmd.sweep(ATTACKER, USDC, 0n)]))
      ).toEqual([ATTACKER])
    })

    describe('a route that is split in many parts', () => {
      // ETH is paid in two ways, one part goes through USDC and the rest goes direct to USDT
      const splitRoute = (lastRecipient: string) => [
        cmd.wrap(ADDRESS_THIS, 5n),
        v4Swap([v4.settle(NATIVE, 5n), singleSwap(NATIVE, USDC), v4.take(ADDRESS_THIS, USDC, 0n)]),
        cmd.v3In(ADDRESS_THIS, [WETH, USDC]),
        cmd.v3In(lastRecipient, [WETH, USDT]),
        v4Swap([v4.settle(USDC, 5n), singleSwap(USDC, USDT), v4.take(lastRecipient, USDT, 0n)]),
        cmd.sweep(lastRecipient, USDT, 0n)
      ]

      test('is one swap from the token that is paid to the token that is received', () => {
        const visualization = humanize(splitRoute(USER))

        expect(
          visualization.flatMap((item) => (item.type === 'token' ? [item.address] : []))
        ).toEqual([NATIVE, USDT])
        expect(labelsOf(visualization)).toEqual(['Swap', 'for'])
      })

      test('shows the recipient when it is not the signer', () => {
        expect(addressesOf(humanize(splitRoute(ATTACKER)))).toContain(ATTACKER)
      })

      test('is not merged when the swaps end in different tokens', () => {
        const visualization = humanize([cmd.v3In(USER, [WETH, USDC]), cmd.v3In(USER, [WETH, DAI])])

        expect(labelsOf(visualization).filter((label) => label === 'Swap')).toHaveLength(2)
      })

      test('is not merged when the swaps are not connected', () => {
        const visualization = humanize([cmd.v3In(USER, [USDC, WETH]), cmd.v3In(USER, [DAI, USDT])])

        expect(labelsOf(visualization).filter((label) => label === 'Swap')).toHaveLength(2)
      })

      test('does not hide different recipients of the last token', () => {
        const visualization = humanize([
          cmd.v3In(ADDRESS_THIS, [WETH, USDC]),
          cmd.v3In(USER, [USDC, USDT]),
          cmd.v3In(ATTACKER, [USDC, USDT])
        ])

        expect(addressesOf(visualization)).toEqual([ATTACKER])
      })

      test('does not hide a transfer of a token that is passed on', () => {
        const visualization = humanize([
          cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
          cmd.v2In(USER, [WETH, DAI], false),
          cmd.transfer(ATTACKER, WETH, 1n)
        ])

        expect(addressesOf(visualization)).toContain(ATTACKER)
      })
    })

    test('a settle that is dropped does not take the next action with it', () => {
      // the settle of 0 used to be removed twice in the same pass, and the second removal took the
      // transfer to the other address
      const visualization = humanize([
        v4Swap([
          v4.settle(NATIVE, 0n),
          v4.swapExactInSingle(NATIVE, USDC),
          v4.take(ATTACKER, USDC, 0n)
        ])
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })
  })

  test('a normal swap of ETH, with a fee to the fee collector of Uniswap, shows no address', () => {
    const visualization = humanize([
      cmd.wrap(ADDRESS_THIS, 5n),
      cmd.v3In(ADDRESS_THIS, [WETH, USDC]),
      cmd.payPortion(UNISWAP_FEE_RECIPIENT, 25n, USDC),
      cmd.sweep(MSG_SENDER, USDC, 1n)
    ])

    expect(addressesOf(visualization)).toEqual([])
    expect(labelsOf(visualization)).toEqual(['Swap', 'for'])
  })

  describe('Uniswap V4 swap layouts', () => {
    const swapTokens = (visualization: HumanizerVisualization[]) =>
      visualization.flatMap((item) => (item.type === 'token' ? [item.address] : []))

    test.each([true, false])(
      'a single swap is decoded (with minHopPriceX36: %s)',
      (withMinHopPrice) => {
        const visualization = humanize([v4Swap([singleSwap(USDC, DAI, true, withMinHopPrice)])])

        expect(swapTokens(visualization)).toEqual([USDC, DAI])
      }
    )

    test.each([true, false])(
      'a single swap against the order of the pool goes the other way (with minHopPriceX36: %s)',
      (withMinHopPrice) => {
        const visualization = humanize([v4Swap([singleSwap(USDC, DAI, false, withMinHopPrice)])])

        expect(swapTokens(visualization)).toEqual([DAI, USDC])
      }
    )

    test('a swap through a path is decoded with minHopPriceX36', () => {
      const param = coder.encode(
        types(V4_SWAP_ACTION_DESCRIPTORS_WITH_MIN_HOP_PRICE.SWAP_EXACT_IN),
        [[NATIVE, [[USDC, 500, 10, NATIVE, '0x']], [0n], 100n, 1n]]
      )
      const visualization = humanize([v4Swap([{ action: V4_ACTION_CODES.SWAP_EXACT_IN, param }])])

      expect(swapTokens(visualization)).toEqual([NATIVE, USDC])
    })
  })
})
