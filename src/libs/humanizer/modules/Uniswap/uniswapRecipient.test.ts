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
import { COMMANDS, V4_ACTION_CODES, V4_ACTION_DESCRIPTORS } from './Commands'
import { uniReduce } from './utils'

const coder = new AbiCoder()
const executeAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'
])
const executeNoDeadlineAbi = parseAbi(['function execute(bytes commands, bytes[] inputs) payable'])
const swapRouter02Abi = parseAbi([
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])',
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function sweepToken(address token, uint256 amountMinimum, address recipient) payable'
])

const USER = '0xb674f3fd5f43464db0448a57529eaf37f04ccea5'
const ATTACKER = '0x1111111111111111111111111111111111111111'
const OTHER_ATTACKER = '0x2222222222222222222222222222222222222222'
const MSG_SENDER = '0x0000000000000000000000000000000000000001'
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002'
const UNISWAP_FEE_RECIPIENT = '0x000000fee13a103a10d593b9ae06b3e05f2e7e1c'
const ROUTER = '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
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
  }),
  takePortion: (recipient: string, bips: bigint, currency = WETH) => ({
    action: V4_ACTION_CODES.TAKE_PORTION,
    param: coder.encode(
      V4_ACTION_DESCRIPTORS.TAKE_PORTION.map((d) => d.type),
      [currency, recipient, bips]
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

describe('Uniswap Universal Router: the recipient of the funds is always shown', () => {
  describe('swap commands', () => {
    const swapCommands: [string, (recipient: string) => Command][] = [
      ['V3_SWAP_EXACT_IN', (recipient) => cmd.v3In(recipient)],
      ['V3_SWAP_EXACT_OUT', (recipient) => cmd.v3Out(recipient)],
      ['V2_SWAP_EXACT_IN', (recipient) => cmd.v2In(recipient)],
      ['V2_SWAP_EXACT_OUT', (recipient) => cmd.v2Out(recipient)]
    ]

    test.each(swapCommands)('%s to another address shows that address', (_name, build) => {
      const visualization = humanize([build(ATTACKER)])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization)).toContain('and send it to')
    })

    test.each(swapCommands)('%s keeps the exact structure of the summary', (_name, build) => {
      const visualization = humanize([build(ATTACKER)])
      const swapItems = visualization.filter((item) => item.type !== 'deadline')
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
      expect(addressesOf(humanize([build(USER)]))).toEqual([])
    })

    test.each(swapCommands)('%s ignores the case of the signer address', (_name, build) => {
      expect(addressesOf(humanize([build(getAddress(USER))]))).toEqual([])
      expect(addressesOf(humanize([build(USER.toUpperCase().replace('0X', '0x'))]))).toEqual([])
    })

    test.each(swapCommands)('%s to MSG_SENDER shows no recipient', (_name, build) => {
      expect(addressesOf(humanize([build(MSG_SENDER)]))).toEqual([])
    })

    test.each(swapCommands)(
      '%s to the router (ADDRESS_THIS) shows no recipient',
      (_name, build) => {
        expect(addressesOf(humanize([build(ADDRESS_THIS)]))).toEqual([])
      }
    )

    test.each(swapCommands)('%s to the router address shows no recipient', (_name, build) => {
      expect(addressesOf(humanize([build(ROUTER)]))).toEqual([])
    })

    test.each(swapCommands)(
      '%s to the zero address is shown, as the tokens are lost',
      (_name, build) => {
        expect(addressesOf(humanize([build(NATIVE)]))).toEqual([NATIVE])
      }
    )

    test('a V3 swap through several pools shows the recipient', () => {
      const visualization = humanize([cmd.v3In(ATTACKER, [USDC, WETH, DAI])])
      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('a swap that is a different signer than the recipient is shown for that signer', () => {
      // the same transaction is harmless for the account that is the recipient
      expect(addressesOf(humanize([cmd.v3In(ATTACKER)], ATTACKER))).toEqual([])
      expect(addressesOf(humanize([cmd.v3In(ATTACKER)], USER))).toEqual([ATTACKER])
    })
  })

  describe('alternative V2 swap encoding (routers with an isUni flag)', () => {
    test('a swap to another address shows that address', () => {
      expect(addressesOf(humanize([cmd.altV2In(ATTACKER, [USDC, WETH], true)]))).toEqual([ATTACKER])
    })

    test('a swap to the signer shows nothing', () => {
      expect(addressesOf(humanize([cmd.altV2In(USER, [USDC, WETH], true)]))).toEqual([])
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

    test('a hop that is followed by a hop paid by the signer still shows its recipient', () => {
      const visualization = humanize([
        cmd.v3In(ATTACKER, [WETH, DAI]),
        cmd.altV2In(USER, [DAI, USDC], true)
      ])

      expect(addressesOf(visualization)).toContain(ATTACKER)
    })

    test('a hop followed by a swap of another token still shows its recipient', () => {
      const visualization = humanize([
        cmd.v3In(ATTACKER, [WETH, DAI]),
        cmd.altV2In(USER, [USDC, WETH], false)
      ])

      expect(addressesOf(visualization)).toContain(ATTACKER)
    })

    test('the last hop shows its recipient', () => {
      const pool = '0x328cc728dce83e80dbe55df9ba35baa6f1aa13a6'
      const visualization = humanize([
        cmd.v3In(pool, [WETH, DAI]),
        cmd.altV2In(ATTACKER, [DAI, USDC], false)
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })
  })

  describe('commands that move funds to a recipient', () => {
    test('SWEEP to another address with a zero minimum shows the transfer', () => {
      const visualization = humanize([cmd.sweep(ATTACKER, USDC, 0n)])
      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization)).toContain('Send')
    })

    test('SWEEP to the signer is a "Take", whatever the case of the address', () => {
      expect(labelsOf(humanize([cmd.sweep(USER)]))).toContain('Take')
      expect(labelsOf(humanize([cmd.sweep(getAddress(USER))]))).toContain('Take')
      expect(labelsOf(humanize([cmd.sweep(MSG_SENDER)]))).toContain('Take')
    })

    test('TRANSFER to another address with a zero value shows the transfer', () => {
      const visualization = humanize([cmd.transfer(ATTACKER, USDC, 0n)])
      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('TRANSFER of the token that is swapped shows the transfer', () => {
      const visualization = humanize([cmd.transfer(ATTACKER, USDC, 5n), cmd.v3In(USER)])
      expect(addressesOf(visualization)).toContain(ATTACKER)
    })

    test('TRANSFER to the fee collector of Uniswap after a swap stays hidden', () => {
      const visualization = humanize([cmd.v3In(USER), cmd.transfer(UNISWAP_FEE_RECIPIENT, WETH)])
      expect(addressesOf(visualization)).toEqual([])
    })

    test('UNWRAP_WETH to another address with a zero minimum shows the recipient', () => {
      const visualization = humanize([cmd.unwrap(ATTACKER, 0n)])
      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization)).toContain('Unwrap')
    })

    test('UNWRAP_WETH to the signer with a zero minimum shows nothing', () => {
      expect(humanize([cmd.unwrap(USER, 0n)])).toEqual([])
    })

    test('WRAP_ETH for another address shows the recipient, also with a zero minimum', () => {
      expect(addressesOf(humanize([cmd.wrap(ATTACKER, 5n)]))).toEqual([ATTACKER])
      expect(addressesOf(humanize([cmd.wrap(ATTACKER, 0n)]))).toEqual([ATTACKER])
    })

    test('WRAP_ETH for the router (the first step of a swap) shows no recipient', () => {
      expect(addressesOf(humanize([cmd.wrap(ADDRESS_THIS, 5n)]))).toEqual([])
      expect(addressesOf(humanize([cmd.wrap(ROUTER, 5n)]))).toEqual([])
    })

    test('PERMIT2_TRANSFER_FROM to another address shows the transfer', () => {
      const visualization = humanize([cmd.permit2TransferFrom(ATTACKER)])
      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization)).toContain('Send')
    })

    test('PERMIT2_TRANSFER_FROM to the router keeps the generic description', () => {
      const visualization = humanize([cmd.permit2TransferFrom(ADDRESS_THIS)])
      expect(addressesOf(visualization)).toEqual([getAddress(ROUTER).toLowerCase()])
      expect(labelsOf(visualization)).toEqual(['Uniswap action', 'to'])
    })

    describe('PAY_PORTION', () => {
      test('a share of more than 1% to another address is shown', () => {
        const visualization = humanize([cmd.payPortion(ATTACKER, 10000n)])
        expect(addressesOf(visualization)).toEqual([ATTACKER])
        expect(visualization.some((item) => item.content === '100%')).toBe(true)
      })

      test('a share of 1.01% to another address is shown', () => {
        expect(addressesOf(humanize([cmd.payPortion(ATTACKER, 101n)]))).toEqual([ATTACKER])
      })

      test('an ordinary interface fee of up to 1% stays hidden', () => {
        expect(humanize([cmd.payPortion(ATTACKER, 100n)])).toEqual([])
        expect(humanize([cmd.payPortion(ATTACKER, 25n)])).toEqual([])
      })

      test('the fee collector of Uniswap stays hidden', () => {
        expect(humanize([cmd.payPortion(UNISWAP_FEE_RECIPIENT, 10000n)])).toEqual([])
      })

      test('a share to the signer or to the router stays hidden', () => {
        expect(humanize([cmd.payPortion(USER, 10000n)])).toEqual([])
        expect(humanize([cmd.payPortion(ADDRESS_THIS, 10000n)])).toEqual([])
      })

      test('a large share to another address is shown next to a swap', () => {
        const visualization = humanize([cmd.v3In(ADDRESS_THIS), cmd.payPortion(ATTACKER, 9000n)])
        expect(addressesOf(visualization)).toContain(ATTACKER)
      })
    })
  })

  describe('Uniswap V4 swaps', () => {
    test('TAKE to another address shows the transfer, also with the "all" amount (0)', () => {
      const visualization = humanize([
        v4Swap([v4.settle(), v4.swapExactInSingle(), v4.take(ATTACKER, WETH, 0n)])
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization)).toContain('Send')
    })

    test('TAKE to another address with an amount shows the transfer', () => {
      const visualization = humanize([
        v4Swap([v4.settle(), v4.swapExactInSingle(), v4.take(ATTACKER, WETH, 42n)])
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('TAKE to the signer (any case) or to the router is not a transfer to another address', () => {
      ;[USER, getAddress(USER), ADDRESS_THIS, MSG_SENDER, ROUTER].forEach((recipient) => {
        const visualization = humanize([
          v4Swap([v4.settle(), v4.swapExactInSingle(), v4.take(recipient, WETH, 42n)])
        ])
        expect(addressesOf(visualization)).toEqual([])
      })
    })

    test('TAKE_PORTION to another address is shown, to the signer in any case it is not', () => {
      expect(
        addressesOf(humanize([v4Swap([v4.swapExactInSingle(), v4.takePortion(ATTACKER, 10000n)])]))
      ).toEqual([ATTACKER])
      expect(
        addressesOf(
          humanize([v4Swap([v4.swapExactInSingle(), v4.takePortion(getAddress(USER), 10000n)])])
        )
      ).toEqual([])
    })

    test('a settle that is dropped does not take the transfer of the next action with it', () => {
      // BUG (fixed): the settle of 0 was removed twice in the same pass, and the second removal
      // took the transfer to the other address
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

  describe('merging of the summary (uniReduce) does not hide the recipient', () => {
    test('a swap to the router and an unwrap for the signer are merged into one swap', () => {
      const visualization = humanize([cmd.v3In(ADDRESS_THIS, [USDC, WETH]), cmd.unwrap(USER, 0n)])

      expect(addressesOf(visualization)).toEqual([])
      expect(labelsOf(visualization).filter((label) => label === 'Swap')).toHaveLength(1)
      expect(labelsOf(visualization)).not.toContain('Unwrap')
    })

    test('a swap to the router and an unwrap for another address are not merged', () => {
      const visualization = humanize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.unwrap(ATTACKER, 0n)
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization)).toContain('Unwrap')
    })

    test('an unwrap for another address after a swap with a matching amount is not merged', () => {
      const visualization = humanize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.unwrap(ATTACKER, 12345n)
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('a wrap for another address is not merged into the swap that follows it', () => {
      const visualization = humanize([cmd.wrap(ATTACKER, 7n), cmd.v3In(USER, [WETH, USDC])])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization)).toContain('Wrap')
    })

    test('a wrap for the router is merged into the swap that follows it', () => {
      const visualization = humanize([cmd.wrap(ADDRESS_THIS, 7n), cmd.v3In(USER, [WETH, USDC])])

      expect(addressesOf(visualization)).toEqual([])
      expect(labelsOf(visualization)).not.toContain('Wrap')
    })

    test('two swaps of the same tokens to different recipients are not merged', () => {
      const visualization = humanize([cmd.v3In(USER), cmd.v3In(ATTACKER)])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization).filter((label) => label === 'Swap')).toHaveLength(2)
    })

    test('two swaps of the same tokens to the same recipient are merged', () => {
      const visualization = humanize([cmd.v3In(ATTACKER), cmd.v3In(ATTACKER)])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization).filter((label) => label === 'Swap')).toHaveLength(1)
    })

    test('two swaps of the same tokens to the signer are merged without a recipient', () => {
      const visualization = humanize([cmd.v3In(USER), cmd.v3In(MSG_SENDER)])

      expect(addressesOf(visualization)).toEqual([])
      expect(labelsOf(visualization).filter((label) => label === 'Swap')).toHaveLength(1)
    })

    test('two swaps that are one after the other keep the recipient of the last one', () => {
      const visualization = humanize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.v2In(ATTACKER, [WETH, DAI], false)
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      const [tokenIn, tokenOut] = visualization.filter((item) => item.type === 'token')
      expect(tokenIn!.address).toBe(USDC)
      expect(tokenOut!.address).toBe(DAI)
    })

    test('two swaps that are one after the other, to the signer, are merged without a recipient', () => {
      const visualization = humanize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.v2In(USER, [WETH, DAI], false)
      ])

      expect(addressesOf(visualization)).toEqual([])
      expect(labelsOf(visualization).filter((label) => label === 'Swap')).toHaveLength(1)
    })

    test('a first swap to another address is not merged into the swap that follows it', () => {
      const visualization = humanize([
        cmd.v3In(ATTACKER, [USDC, WETH]),
        cmd.v2In(USER, [WETH, DAI], true)
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
      expect(labelsOf(visualization).filter((label) => label === 'Swap')).toHaveLength(2)
    })

    test('a swap to another address is not hidden by a sweep of the same token to the signer', () => {
      const visualization = humanize([cmd.v3In(ATTACKER, [USDC, WETH]), cmd.sweep(USER, WETH, 1n)])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('a sweep to another address is not hidden by a swap of that token', () => {
      const visualization = humanize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.sweep(ATTACKER, USDC, 0n)
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('a transfer to another address is not hidden by a swap that comes after it', () => {
      const visualization = humanize([
        cmd.transfer(ATTACKER, USDC, 1n),
        cmd.v3In(USER, [USDC, WETH])
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })

    test('three swaps with the recipient in the middle one', () => {
      const visualization = humanize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.v3In(ATTACKER, [WETH, DAI]),
        cmd.v3In(USER, [DAI, USDC])
      ])

      expect(addressesOf(visualization)).toContain(ATTACKER)
    })

    test('two recipients are both shown', () => {
      const visualization = humanize([
        cmd.v3In(ATTACKER, [USDC, WETH]),
        cmd.v3In(OTHER_ATTACKER, [USDC, DAI])
      ])

      expect(addressesOf(visualization).sort()).toEqual([ATTACKER, OTHER_ATTACKER])
    })

    test('a swap through the native token with an unwrap for another address', () => {
      const visualization = humanize([
        cmd.wrap(ADDRESS_THIS, 5n),
        cmd.v3In(ADDRESS_THIS, [WETH, USDC]),
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.unwrap(ATTACKER, 0n)
      ])

      expect(addressesOf(visualization)).toEqual([ATTACKER])
    })
  })

  describe('SwapProxy', () => {
    test('shows the recipient of the swaps it forwards', () => {
      const proxyAbi = parseAbi([
        'function execute(address router, address token, uint256 amount, bytes commands, bytes[] inputs, uint256 deadline) payable'
      ])
      const commands = [cmd.v3In(ATTACKER)]
      const humanized = uniswapHumanizer(accountOp, {
        to: '0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9',
        value: 0n,
        data: encodeFunctionData({
          abi: proxyAbi,
          functionName: 'execute',
          args: [
            ROUTER as `0x${string}`,
            USDC as `0x${string}`,
            100n,
            `0x${commands.map(({ id }) => id.slice(2)).join('')}`,
            commands.map(({ input }) => input as `0x${string}`),
            DEADLINE
          ]
        })
      })

      expect(addressesOf(humanized.fullVisualization || [])).toEqual([ATTACKER])
    })
  })

  describe('flows that must stay quiet', () => {
    test('swap ETH to a token, sweeping to the signer', () => {
      const visualization = humanize([
        cmd.wrap(ADDRESS_THIS, 5n),
        cmd.v3In(ADDRESS_THIS, [WETH, USDC]),
        cmd.sweep(MSG_SENDER, USDC, 1n)
      ])

      expect(addressesOf(visualization)).toEqual([])
      expect(labelsOf(visualization)).toEqual(['Swap', 'for'])
    })

    test('swap a token to ETH, unwrapping for the signer', () => {
      const visualization = humanize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.unwrap(MSG_SENDER, 1n)
      ])

      expect(addressesOf(visualization)).toEqual([])
      expect(labelsOf(visualization)).toEqual(['Swap', 'for'])
    })

    test('a swap with the fee of the interface paid to the fee collector of Uniswap', () => {
      const visualization = humanize([
        cmd.v3In(ADDRESS_THIS, [USDC, WETH]),
        cmd.payPortion(UNISWAP_FEE_RECIPIENT, 25n, WETH),
        cmd.sweep(MSG_SENDER, WETH, 1n)
      ])

      expect(addressesOf(visualization)).toEqual([])
      expect(labelsOf(visualization)).toEqual(['Swap', 'for'])
    })

    test('the same calldata humanizes the same way twice', () => {
      const commands = [cmd.v3In(ATTACKER), cmd.unwrap(OTHER_ATTACKER, 0n)]
      const strip = (visualization: HumanizerVisualization[]) =>
        visualization.map((item) => ({ ...item, id: undefined }))

      expect(strip(humanize(commands))).toEqual(strip(humanize(commands)))
    })
  })

  describe('other entrypoints', () => {
    test('execute without a deadline is not described as a normal swap', () => {
      const commands = [cmd.v3In(ATTACKER)]
      const humanized = uniswapHumanizer(accountOp, {
        to: ROUTER,
        value: 0n,
        data: encodeFunctionData({
          abi: executeNoDeadlineAbi,
          functionName: 'execute',
          args: [
            `0x${commands.map(({ id }) => id.slice(2)).join('')}`,
            commands.map(({ input }) => input as `0x${string}`)
          ]
        })
      })

      expect(labelsOf(humanized.fullVisualization || [])).toEqual(['Uniswap action'])
    })

    test('an unknown command is shown as a generic Uniswap action', () => {
      const visualization = humanize([{ id: '0x21', input: '0x' }])
      expect(labelsOf(visualization)).toEqual(['Uniswap action', 'to'])
    })

    test('SwapRouter02: a swap to the router followed by an unwrap for another address', () => {
      const data = encodeFunctionData({
        abi: swapRouter02Abi,
        functionName: 'multicall',
        args: [
          DEADLINE,
          [
            encodeFunctionData({
              abi: swapRouter02Abi,
              functionName: 'exactInputSingle',
              args: [
                {
                  tokenIn: USDC as `0x${string}`,
                  tokenOut: WETH as `0x${string}`,
                  fee: 500,
                  recipient: ADDRESS_THIS as `0x${string}`,
                  amountIn: 100n,
                  amountOutMinimum: 1n,
                  sqrtPriceLimitX96: 0n
                }
              ]
            }),
            encodeFunctionData({
              abi: swapRouter02Abi,
              functionName: 'unwrapWETH9',
              args: [0n, ATTACKER as `0x${string}`]
            })
          ]
        ]
      })
      const humanized = uniswapHumanizer(accountOp, {
        to: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        value: 0n,
        data
      })

      expect(addressesOf(humanized.fullVisualization || [])).toContain(ATTACKER)
    })

    test('SwapRouter02: a swap to the router followed by an unwrap for the signer is merged', () => {
      const data = encodeFunctionData({
        abi: swapRouter02Abi,
        functionName: 'multicall',
        args: [
          DEADLINE,
          [
            encodeFunctionData({
              abi: swapRouter02Abi,
              functionName: 'exactInputSingle',
              args: [
                {
                  tokenIn: USDC as `0x${string}`,
                  tokenOut: WETH as `0x${string}`,
                  fee: 500,
                  recipient: MSG_SENDER as `0x${string}`,
                  amountIn: 100n,
                  amountOutMinimum: 1n,
                  sqrtPriceLimitX96: 0n
                }
              ]
            }),
            encodeFunctionData({
              abi: swapRouter02Abi,
              functionName: 'unwrapWETH9',
              args: [0n, getAddress(USER) as `0x${string}`]
            })
          ]
        ]
      })
      const humanized = uniswapHumanizer(accountOp, {
        to: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        value: 0n,
        data
      })

      expect(addressesOf(humanized.fullVisualization || [])).toEqual([])
    })
  })

  describe('uniReduce', () => {
    test('keeps the recipient of every call when there is nothing to merge', () => {
      const reduced = uniReduce([
        [getAction('Send'), getToken(USDC, 1n), getLabel('to'), getAddressVisualization(ATTACKER)],
        [
          getAction('Send'),
          getToken(DAI, 1n),
          getLabel('to'),
          getAddressVisualization(OTHER_ATTACKER)
        ]
      ])

      expect(addressesOf(reduced)).toEqual([ATTACKER, OTHER_ATTACKER])
    })

    test('does not add anything when no address is lost', () => {
      const reduced = uniReduce([
        [getAction('Swap'), getToken(USDC, 0n), getLabel('for'), getToken(WETH, 0n)]
      ])

      expect(labelsOf(reduced)).toEqual(['Swap', 'for'])
    })
  })

  // Builds random sequences of commands, where one of the commands sends to another address, and
  // checks that this address is shown, whatever the merging of the commands does. The tokens are
  // taken from a small set, so that commands that can be merged happen often.
  describe('random sequences of commands', () => {
    // small deterministic generator, so that a failure can be repeated
    const createRandom = (seed: number) => {
      let state = seed
      return (maxExclusive: number) => {
        state = (state * 1664525 + 1013904223) % 4294967296
        return Math.floor((state / 4294967296) * maxExclusive)
      }
    }
    const tokens = [WETH, USDC, DAI]
    const safeRecipients = [USER, MSG_SENDER, ADDRESS_THIS, ROUTER]

    const randomToken = (random: (max: number) => number) => tokens[random(tokens.length)]!
    const randomPair = (random: (max: number) => number) => {
      const first = random(tokens.length)
      return [tokens[first]!, tokens[(first + 1 + random(tokens.length - 1)) % tokens.length]!]
    }

    const builders: ((recipient: string, random: (max: number) => number) => Command)[] = [
      (recipient, random) => cmd.v3In(recipient, randomPair(random)),
      (recipient, random) => cmd.v3Out(recipient, randomPair(random)),
      (recipient, random) => cmd.v2In(recipient, randomPair(random), random(2) === 0),
      (recipient, random) => cmd.v2Out(recipient, randomPair(random)),
      (recipient, random) => cmd.sweep(recipient, randomToken(random), BigInt(random(2))),
      (recipient, random) => cmd.transfer(recipient, randomToken(random), BigInt(random(2))),
      (recipient, random) => cmd.payPortion(recipient, 5000n, randomToken(random)),
      (recipient, random) => cmd.wrap(recipient, BigInt(random(2))),
      (recipient, random) => cmd.unwrap(recipient, BigInt(random(2))),
      (recipient, random) => cmd.permit2TransferFrom(recipient, randomToken(random)),
      (recipient, random) => {
        const [currency0, currency1] = randomPair(random)
        return v4Swap([
          v4.settle(currency0, BigInt(random(2))),
          v4.swapExactInSingle(currency0, currency1),
          v4.take(recipient, currency1, BigInt(random(2)))
        ])
      }
    ]

    test.each(Array.from({ length: 20 }, (_, i) => i + 1))('seed %i', (seed) => {
      const random = createRandom(seed * 7919)

      for (let round = 0; round < 100; round++) {
        const length = 1 + random(5)
        const attackerPosition = random(length)
        const commands = Array.from({ length }, (_, position) => {
          const recipient =
            position === attackerPosition
              ? ATTACKER
              : safeRecipients[random(safeRecipients.length)]!
          return builders[random(builders.length)]!(recipient, random)
        })

        const shown = addressesOf(humanize(commands))
        if (!shown.includes(ATTACKER)) {
          throw new Error(
            `The recipient was hidden. Commands: ${commands.map(({ id }) => id).join(',')}, inputs: ${JSON.stringify(
              commands.map(({ input }) => input)
            )}`
          )
        }
      }
    })
  })
})
