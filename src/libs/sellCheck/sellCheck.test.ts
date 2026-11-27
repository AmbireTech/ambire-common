import { Interface, MaxUint256, parseEther, toQuantity, ZeroAddress } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { RPC_TOKEN_PRICE_CONFIGS } from '../../consts/rpcTokenPrices'
import { getRpcProvider } from '../../services/provider'
import SellChecker from '../../../contracts/compiled/SellChecker.json'
import { AccountOp } from '../accountOp/accountOp'
import { AssetType } from '../defiPositions/types'
import { TokenResult } from '../portfolio/interfaces'
import {
  checkIncomingTokenSales,
  getIncomingTokensToCheckSales,
  getSellCheckRequest,
  MAX_TOKENS_TO_CHECK_SALES,
  parseSellCheckResponse,
  SELL_CHECK_BLOCKS_LATER,
  SELL_CHECK_SECONDS_LATER,
  SELL_CHECKER_ADDRESS,
  SimulatedBlock,
  TokenToCheckSale
} from './sellCheck'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!
const ethereumSpotPrices = RPC_TOKEN_PRICE_CONFIGS['1']!.spotPrices!

const ACCOUNT = '0x0000000000000000000000000000000000000B0b'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
// A Gas Tank fee token on Ethereum, one of our curated tokens
const STETH = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
const PEPE = '0x6982508145454Ce325dDbE47a25d4ec3d2311933'
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
const TOKEN_1 = '0x1111111111111111111111111111111111111111'
const TOKEN_2 = '0x2222222222222222222222222222222222222222'

const sellCheckerInterface = new Interface(SellChecker.abi)
const erc20Interface = new Interface(['function approve(address spender, uint256 amount)'])

const makeToken = (
  address: string,
  simulationAmount: bigint | undefined,
  overrides: Partial<TokenResult> = {}
): TokenResult => ({
  symbol: 'TKN',
  name: 'Token',
  decimals: 18,
  address,
  chainId: 1n,
  amount: 0n,
  simulationAmount,
  priceIn: [],
  marketDataIn: [],
  flags: { onGasTank: false, rewardsType: null, canTopUpGasTank: false, isFeeToken: false },
  ...overrides
})

const makeAccountOp = (calls: AccountOp['calls']): AccountOp => ({
  id: 'sell-check-test',
  accountAddr: ACCOUNT,
  chainId: 1n,
  signingKeyAddr: null,
  signingKeyType: null,
  nonce: null,
  calls,
  gasLimit: null,
  signature: null,
  gasFeePayment: null
})

/** The response of a simulation whose sell check returned `checks` */
const makeResponse = (checks: [status: number, sellFeeBps: number][]): SimulatedBlock[] => [
  { calls: [{ status: '0x1', returnData: '0x' }] },
  {
    calls: [
      { status: '0x1', returnData: '0x' },
      {
        status: '0x1',
        returnData: sellCheckerInterface.encodeFunctionResult('checkSales', [checks])
      }
    ]
  }
]

const SOLD = 1
const FAILED = 2
const UNKNOWN = 0

describe('getIncomingTokensToCheckSales', () => {
  test('returns the tokens the transaction adds, with how much of them it adds', () => {
    expect(
      getIncomingTokensToCheckSales([makeToken(TOKEN_1, 5n), makeToken(TOKEN_2, 7n)], 1n)
    ).toEqual([
      { address: TOKEN_1, amount: 5n },
      { address: TOKEN_2, amount: 7n }
    ])
  })

  test('leaves out the tokens the transaction takes or leaves unchanged', () => {
    expect(
      getIncomingTokensToCheckSales(
        [makeToken(TOKEN_1, -5n), makeToken(TOKEN_2, 0n), makeToken(PEPE, undefined)],
        1n
      )
    ).toEqual([])
  })

  test('leaves out the native token, the wrapped native token, the stablecoins and our curated tokens', () => {
    expect(
      getIncomingTokensToCheckSales(
        [
          makeToken(ZeroAddress, 5n),
          makeToken(WETH, 5n),
          makeToken(USDC, 5n),
          makeToken(STETH, 5n),
          makeToken(TOKEN_1, 5n)
        ],
        1n
      )
    ).toEqual([{ address: TOKEN_1, amount: 5n }])
  })

  test('leaves out Gas Tank, rewards and DeFi position tokens', () => {
    const flags = makeToken(TOKEN_1, 5n).flags

    expect(
      getIncomingTokensToCheckSales(
        [
          makeToken(TOKEN_1, 5n, { flags: { ...flags, onGasTank: true } }),
          makeToken(TOKEN_1, 5n, { flags: { ...flags, rewardsType: 'wallet-rewards' } }),
          makeToken(TOKEN_1, 5n, { flags: { ...flags, defiTokenType: AssetType.Collateral } })
        ],
        1n
      )
    ).toEqual([])
  })

  test('leaves out the tokens of other networks', () => {
    expect(getIncomingTokensToCheckSales([makeToken(TOKEN_1, 5n, { chainId: 10n })], 1n)).toEqual(
      []
    )
  })

  test('checks nothing on a network whose DEXes we have no config for', () => {
    // Scroll prices only its native token from the RPC, with no DEXes configured
    expect(
      getIncomingTokensToCheckSales([makeToken(TOKEN_1, 5n, { chainId: 534352n })], 534352n)
    ).toEqual([])
  })

  test(`checks at most ${MAX_TOKENS_TO_CHECK_SALES} tokens`, () => {
    const tokens = Array.from({ length: MAX_TOKENS_TO_CHECK_SALES + 2 }, (_, index) =>
      makeToken(`0x${(index + 1).toString(16).padStart(40, '0')}`, 5n)
    )

    expect(getIncomingTokensToCheckSales(tokens, 1n)).toHaveLength(MAX_TOKENS_TO_CHECK_SALES)
  })
})

describe('getSellCheckRequest', () => {
  const accountOp = makeAccountOp([{ to: TOKEN_1, value: 1n, data: '0xabcdef' }])
  const tokens: TokenToCheckSale[] = [
    { address: TOKEN_1, amount: 100n },
    { address: TOKEN_2, amount: 200n }
  ]
  const latestBlock = { number: 1000, timestamp: 1_700_000_000 }
  const [request, baseBlock] = getSellCheckRequest({
    accountOp,
    tokens,
    spotPrices: ethereumSpotPrices,
    latestBlock
  })!
  const [transactionBlock, saleBlock] = request.blockStateCalls

  test('simulates on top of the block the sale block number comes from, not the latest one', () => {
    // A newer latest block could pass the sale's block number, which the RPC rejects
    expect(baseBlock).toBe(toQuantity(latestBlock.number))
  })

  test("runs the transaction's calls from the account first, with the sell checker's code in place", () => {
    expect(transactionBlock!.calls).toEqual([
      { to: TOKEN_1, value: '0x1', data: '0xabcdef', from: ACCOUNT }
    ])
    expect(transactionBlock!.stateOverrides?.[SELL_CHECKER_ADDRESS]).toEqual({
      code: SellChecker.binRuntime
    })
    // The account can pay for any call, as in the token discovery simulation
    expect(transactionBlock!.stateOverrides?.[ACCOUNT]?.balance).toBeDefined()
    expect(request.validation).toBe(false)
  })

  test('sells in a later block, after the cooldowns of normal tokens', () => {
    expect(saleBlock!.blockOverrides).toEqual({
      number: toQuantity(latestBlock.number + 1 + SELL_CHECK_BLOCKS_LATER),
      time: toQuantity(latestBlock.timestamp + SELL_CHECK_SECONDS_LATER)
    })
  })

  test('approves the sell checker from the account for each token, then sells what the transaction added', () => {
    const calls = saleBlock!.calls
    expect(calls).toHaveLength(tokens.length + 1)
    tokens.forEach(({ address }, index) => {
      expect(calls[index]).toEqual({
        from: ACCOUNT,
        to: address,
        value: '0x0',
        data: erc20Interface.encodeFunctionData('approve', [SELL_CHECKER_ADDRESS, MaxUint256])
      })
    })

    const sellCheck = calls.at(-1)!
    expect(sellCheck.to).toBe(SELL_CHECKER_ADDRESS)
    const [owner, checkedTokens, amounts, search] = sellCheckerInterface.decodeFunctionData(
      'checkSales',
      sellCheck.data
    )
    expect(owner).toBe(ACCOUNT)
    expect([...checkedTokens]).toEqual([TOKEN_1, TOKEN_2])
    expect([...amounts]).toEqual([100n, 200n])
    expect(search.wrappedNative).toBe(ethereumSpotPrices.wrappedNative)
    expect([...search.stablecoins]).toEqual(ethereumSpotPrices.stablecoins)
    expect(search.factories).toHaveLength(ethereumSpotPrices.poolFactories.length)
  })
})

describe('parseSellCheckResponse', () => {
  const tokens: TokenToCheckSale[] = [{ address: TOKEN_1, amount: 100n }]

  test('reports a token whose every sale failed as one that cannot be sold', () => {
    expect(parseSellCheckResponse(makeResponse([[FAILED, 0]]), tokens)).toEqual([
      { address: TOKEN_1, kind: 'cannot-sell', sellFeePercent: 100 }
    ])
  })

  test('reports a token that keeps 90% or more of a sale as one that cannot be sold', () => {
    expect(parseSellCheckResponse(makeResponse([[SOLD, 10_000]]), tokens)).toEqual([
      { address: TOKEN_1, kind: 'cannot-sell', sellFeePercent: 100 }
    ])
    expect(parseSellCheckResponse(makeResponse([[SOLD, 9_000]]), tokens)).toEqual([
      { address: TOKEN_1, kind: 'cannot-sell', sellFeePercent: 90 }
    ])
  })

  test('reports a token that keeps 10% or more of a sale as having a high selling fee', () => {
    expect(parseSellCheckResponse(makeResponse([[SOLD, 3_249]]), tokens)).toEqual([
      { address: TOKEN_1, kind: 'high-sell-fee', sellFeePercent: 32 }
    ])
    expect(parseSellCheckResponse(makeResponse([[SOLD, 1_000]]), tokens)).toEqual([
      { address: TOKEN_1, kind: 'high-sell-fee', sellFeePercent: 10 }
    ])
  })

  test('reports nothing for a token sold with a fee under 10%', () => {
    expect(parseSellCheckResponse(makeResponse([[SOLD, 999]]), tokens)).toEqual([])
    expect(parseSellCheckResponse(makeResponse([[SOLD, 0]]), tokens)).toEqual([])
  })

  test('reports nothing for a token the check could tell nothing about, e.g. without pools', () => {
    expect(parseSellCheckResponse(makeResponse([[UNKNOWN, 0]]), tokens)).toEqual([])
  })

  test('matches each result to its token', () => {
    expect(
      parseSellCheckResponse(
        makeResponse([
          [SOLD, 0],
          [FAILED, 0]
        ]),
        [...tokens, { address: TOKEN_2, amount: 5n }]
      )
    ).toEqual([{ address: TOKEN_2, kind: 'cannot-sell', sellFeePercent: 100 }])
  })

  test('throws, rather than reporting the tokens as safe, when the sell check itself failed', () => {
    const response = makeResponse([[SOLD, 0]])
    response[1]!.calls[1] = { status: '0x0', returnData: '0x', error: { message: 'out of gas' } }

    expect(() => parseSellCheckResponse(response, tokens)).toThrow('out of gas')
  })

  test('throws when the response has no sell check', () => {
    expect(() => parseSellCheckResponse([], tokens)).toThrow()
  })
})

describe('checkIncomingTokenSales', () => {
  test('checks nothing, without calling the RPC, when there are no tokens', async () => {
    const send = jest.fn()
    const provider = { send, getBlock: jest.fn() } as any

    expect(
      await checkIncomingTokenSales({ provider, accountOp: makeAccountOp([]), tokens: [] })
    ).toEqual([])
    expect(send).not.toHaveBeenCalled()
  })

  test('sends the request with eth_simulateV1 and reports what the sell check found', async () => {
    const send = jest.fn<(method: string, params: unknown) => Promise<SimulatedBlock[]>>(async () =>
      makeResponse([[FAILED, 0]])
    )
    const provider = {
      send,
      getBlock: jest.fn(async () => ({ number: 1000, timestamp: 1_700_000_000 }))
    } as any

    expect(
      await checkIncomingTokenSales({
        provider,
        accountOp: makeAccountOp([{ to: TOKEN_1, value: 0n, data: '0x' }]),
        tokens: [{ address: TOKEN_1, amount: 100n }]
      })
    ).toEqual([{ address: TOKEN_1, kind: 'cannot-sell', sellFeePercent: 100 }])
    expect(send).toHaveBeenCalledWith('eth_simulateV1', expect.any(Array))
  })

  test('throws when the RPC does not support eth_simulateV1', async () => {
    const provider = {
      send: jest.fn(async () => {
        throw new Error('the method eth_simulateV1 does not exist')
      }),
      getBlock: jest.fn(async () => ({ number: 1000, timestamp: 1_700_000_000 }))
    } as any

    await expect(
      checkIncomingTokenSales({
        provider,
        accountOp: makeAccountOp([{ to: TOKEN_1, value: 0n, data: '0x' }]),
        tokens: [{ address: TOKEN_1, amount: 100n }]
      })
    ).rejects.toThrow('eth_simulateV1')
  })

  describe('against the live RPC', () => {
    const provider = getRpcProvider(ethereum.rpcUrls, ethereum.chainId)
    // Buys PEPE with 0.05 ETH through Uniswap v2
    const buyPepe = makeAccountOp([
      {
        to: UNISWAP_V2_ROUTER,
        value: parseEther('0.05'),
        data: new Interface([
          'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable'
        ]).encodeFunctionData('swapExactETHForTokens', [0, [WETH, PEPE], ACCOUNT, MaxUint256])
      }
    ])

    test('reports nothing for a normal token bought in the transaction', async () => {
      // Less than 0.05 ETH buys, so that the sale doesn't depend on PEPE's price
      const tokens = [{ address: PEPE, amount: 1_000_000n * 10n ** 18n }]

      expect(await checkIncomingTokenSales({ provider, accountOp: buyPepe, tokens })).toEqual([])
    })

    test('reports nothing for a token with no pools on the DEXes it knows', async () => {
      const tokens = [{ address: TOKEN_1, amount: 100n }]

      expect(await checkIncomingTokenSales({ provider, accountOp: buyPepe, tokens })).toEqual([])
    })

    test('reports a token whose every sale fails as one that cannot be sold', async () => {
      // UNI, which the account doesn't hold: each sale into its pools fails, the way it does for
      // a token that blocks selling
      const tokens = [{ address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', amount: 10n ** 18n }]

      expect(await checkIncomingTokenSales({ provider, accountOp: buyPepe, tokens })).toEqual([
        { address: tokens[0]!.address, kind: 'cannot-sell', sellFeePercent: 100 }
      ])
    })
  })
})
