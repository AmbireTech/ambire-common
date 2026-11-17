import { formatUnits, getAddress, Interface, keccak256, toUtf8Bytes, ZeroAddress } from 'ethers'

import { describe, expect, it, jest } from '@jest/globals'

import { SwapAndBridgeRoute } from '../../interfaces/swapAndBridge'
import { CowSwapAPI } from './api'
import {
  COWSWAP_BFF_BASE_URL,
  COWSWAP_BUY_NATIVE_TOKEN_ADDRESS,
  COWSWAP_ETH_FLOW_ADDRESS,
  COWSWAP_SETTLEMENT_ADDRESS,
  COWSWAP_SMART_SLIPPAGE_CACHE_MS,
  COWSWAP_SMART_SLIPPAGE_FAILURE_CACHE_MS,
  COWSWAP_SMART_SLIPPAGE_TIMEOUT_MS,
  COWSWAP_TOKEN_LIST_CACHE_MS,
  COWSWAP_TOKEN_LIST_URL,
  COWSWAP_VAULT_RELAYER_ADDRESS
} from './constants'
import { getCowSwapOrderStruct, getCowSwapOrderUid } from './helper'

const settlementInterface = new Interface(['function setPreSignature(bytes orderUid, bool signed)'])
const ethFlowInterface = new Interface([
  'function createOrder((address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,bytes32 appData,uint256 feeAmount,uint32 validTo,bool partiallyFillable,int64 quoteId) order) payable returns (bytes32 orderHash)'
])

const userAddress = '0x0000000000000000000000000000000000000001'
const tokenIn = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const tokenOut = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const baseUsdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const baseWeth = '0x4200000000000000000000000000000000000006'
const safeTokenAddress = '0x5afe3855358e112b5647b952709e6165e1c1eeee'
const cowSwapApiKey = 'cow-swap-api-key'

const makeResponse = (body: any, ok = true, status = ok ? 200 : 400) => ({
  ok,
  status,
  json: async () => body
})

const makeQuoteParams = (overrides: Record<string, unknown> = {}) => ({
  fromAsset: {
    address: tokenIn,
    amount: 1000000n,
    chainId: 1n,
    decimals: 6,
    flags: { canTopUpGasTank: false, isFeeToken: false, onGasTank: false, rewardsType: null },
    marketDataIn: [],
    name: 'USD Coin',
    priceIn: [{ baseCurrency: 'usd', price: 1 }],
    symbol: 'USDC'
  } as any,
  fromChainId: 1,
  fromTokenAddress: tokenIn,
  toAsset: {
    address: tokenOut,
    chainId: 1,
    decimals: 18,
    name: 'Wrapped Ether',
    priceUSD: '2000',
    symbol: 'WETH'
  },
  toChainId: 1,
  toTokenAddress: tokenOut,
  fromAmount: 1000000n,
  userAddress,
  sort: 'output' as const,
  isWrapOrUnwrap: false,
  accountNativeBalance: 1n,
  nativeSymbol: 'ETH',
  feePercent: 0.5,
  ...overrides
})

/** The buy amount CoW quotes after deducting its network cost in the fixture below */
const quotedBuyAmount = 500000000000000n
/** The fixture's network cost (1% of the sell amount), converted to the buy token */
const networkFeeInBuyToken = (quotedBuyAmount * 10000n) / 990000n
/**
 * The slippage that lets the fixture's network cost (1% of the sell amount) grow by 50%:
 * 0.5% of the amount sold after the network cost (99%) is 50.5 bps, rounded up
 */
const networkCostSlippageBps = 51n

const isSmartSlippageUrl = (url: string) => url.startsWith(COWSWAP_BFF_BASE_URL)

/** The calls to the CoW Swap order book, without the smart slippage requests */
const getOrderBookCalls = (fetch: { mock: { calls: [any, any][] } }) =>
  fetch.mock.calls.filter(([url]) => !isSmartSlippageUrl(url))

/** The calls to the CoW Swap smart slippage endpoint */
const getSmartSlippageCalls = (fetch: { mock: { calls: [any, any][] } }) =>
  fetch.mock.calls.filter(([url]) => isSmartSlippageUrl(url))

/**
 * By default the smart slippage endpoint has no recommendation for the pair, so quotes use
 * the fixed slippage
 */
const makeQuoteFetch = (
  smartSlippageResponse: () => Promise<any> = async () => makeResponse({ slippageBps: 0 })
) =>
  jest.fn(async (url: any, init: any) => {
    if (isSmartSlippageUrl(url)) return smartSlippageResponse()

    const request = JSON.parse(init.body)
    if (init.method === 'PUT') return makeResponse({ fullAppData: request.fullAppData })

    const totalSellAmount = BigInt(request.sellAmountBeforeFee)
    const networkFee = totalSellAmount / 100n
    return makeResponse({
      quote: {
        sellToken: request.sellToken,
        buyToken: request.buyToken,
        receiver: request.receiver,
        sellAmount: (totalSellAmount - networkFee).toString(),
        buyAmount: quotedBuyAmount.toString(),
        validTo: Math.floor(Date.now() / 1000) + 1800,
        appData: request.appData,
        appDataHash: request.appDataHash,
        feeAmount: networkFee.toString(),
        gasAmount: '150000',
        gasPrice: '1000000000',
        sellTokenPrice: '1',
        kind: 'sell',
        partiallyFillable: false,
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20',
        signingScheme: request.signingScheme
      },
      from: request.from,
      expiration: new Date(Date.now() + 60000).toISOString(),
      id: 7,
      verified: true,
      protocolFeeBps: '0'
    })
  })

const makeRouteFixture = async () => {
  const api = new CowSwapAPI({ fetch: makeQuoteFetch() as any, apiKey: cowSwapApiKey })
  return (await api.quote(makeQuoteParams())).routes[0]!
}

const makeEthFlowQuoteParams = () =>
  makeQuoteParams({
    fromAsset: {
      address: ZeroAddress,
      amount: 1000000000000000000n,
      chainId: 8453n,
      decimals: 18,
      flags: { canTopUpGasTank: false, isFeeToken: false, onGasTank: false, rewardsType: null },
      marketDataIn: [],
      name: 'Ether',
      priceIn: [{ baseCurrency: 'usd', price: 2000 }],
      symbol: 'ETH'
    },
    fromChainId: 8453,
    fromTokenAddress: ZeroAddress,
    toAsset: {
      address: baseUsdc,
      chainId: 8453,
      decimals: 6,
      name: 'USD Coin',
      priceUSD: '1',
      symbol: 'USDC'
    },
    toChainId: 8453,
    toTokenAddress: baseUsdc,
    fromAmount: 1000000000000000000n
  })

const makeEthFlowRouteFixture = async () => {
  const api = new CowSwapAPI({ fetch: makeQuoteFetch() as any, apiKey: cowSwapApiKey })
  return (await api.quote(makeEthFlowQuoteParams())).routes[0]!
}

describe('CowSwapAPI', () => {
  it('fetches and normalizes tokens for the requested chain', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({
        tokens: [
          {
            address: tokenIn.toLowerCase(),
            chainId: 1,
            decimals: 6,
            logoURI: 'https://files.cow.fi/usdc.png',
            name: 'USD Coin',
            symbol: 'USDC'
          },
          {
            address: baseUsdc,
            chainId: 8453,
            decimals: 6,
            name: 'USD Coin',
            symbol: 'USDC'
          },
          {
            address: 'not-an-address',
            chainId: 1,
            decimals: 18,
            name: 'Unsafe token',
            symbol: 'BAD'
          }
        ]
      })
    )
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    const tokens = await api.getToTokenList({ fromChainId: 1, toChainId: 1 })

    expect(fetch).toHaveBeenCalledWith(COWSWAP_TOKEN_LIST_URL, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
    })
    expect(tokens).toContainEqual({
      address: tokenIn,
      chainId: 1,
      decimals: 6,
      icon: 'https://files.cow.fi/usdc.png',
      name: 'USD Coin',
      symbol: 'USDC'
    })
    expect(tokens.some((token) => token.chainId !== 1 || token.symbol === 'BAD')).toBe(false)
  })

  it('rejects malformed token-list responses', async () => {
    const fetch = jest.fn(async () => makeResponse({ tokens: null }))
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    await expect(api.getToTokenList({ fromChainId: 1, toChainId: 1 })).rejects.toThrow(
      'CoW Swap returned an unexpected token list'
    )
  })

  it('finds a token by address in the CowSwap token list', async () => {
    const fetch = jest.fn(async () =>
      makeResponse({
        tokens: [
          {
            address: safeTokenAddress,
            chainId: 1,
            decimals: 18,
            logoURI: 'https://files.cow.fi/safe.png',
            name: 'Safe',
            symbol: 'SAFE'
          }
        ]
      })
    )
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    await expect(api.getToken({ address: safeTokenAddress, chainId: 1 })).resolves.toEqual({
      address: getAddress(safeTokenAddress),
      chainId: 1,
      decimals: 18,
      icon: 'https://files.cow.fi/safe.png',
      name: 'Safe',
      symbol: 'SAFE'
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(COWSWAP_TOKEN_LIST_URL, expect.any(Object))
  })

  it('does not return a token missing from the CowSwap token list from getToken', async () => {
    const customTokenAddress = '0x1111111111111111111111111111111111111111'
    const fetch = (jest.fn() as any).mockResolvedValueOnce(makeResponse({ tokens: [] }))
    const api = new CowSwapAPI({ fetch, apiKey: cowSwapApiKey })

    await expect(api.getToken({ address: customTokenAddress, chainId: 1 })).resolves.toBeNull()
    // No lookup of the token metadata, that is the job of the swap provider executor
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports an unlisted token as supported when CowSwap can price it', async () => {
    const customTokenAddress = '0x1111111111111111111111111111111111111111'
    const fetch = (jest.fn() as any).mockResolvedValueOnce(makeResponse({ price: '1' }))
    const api = new CowSwapAPI({ fetch, apiKey: cowSwapApiKey })

    await expect(api.isTokenSupported({ address: customTokenAddress, chainId: 1 })).resolves.toBe(
      true
    )
    expect(fetch.mock.calls[0][0]).toBe(
      `https://partners.cow.fi/mainnet/api/v1/token/${customTokenAddress}/native_price`
    )
    expect(fetch.mock.calls[0][1].headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': cowSwapApiKey
    })
  })

  it('reports an unlisted token as unsupported without CowSwap liquidity', async () => {
    const customTokenAddress = '0x1111111111111111111111111111111111111111'
    const fetch = (jest.fn() as any).mockResolvedValueOnce(makeResponse({}, false, 404))
    const api = new CowSwapAPI({ fetch, apiKey: cowSwapApiKey })

    await expect(api.isTokenSupported({ address: customTokenAddress, chainId: 1 })).resolves.toBe(
      false
    )
  })

  it('does not call CowSwap for invalid addresses and unsupported networks', async () => {
    const fetch = jest.fn()
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    await expect(api.isTokenSupported({ address: 'not-an-address', chainId: 1 })).resolves.toBe(
      false
    )
    await expect(api.isTokenSupported({ address: tokenIn, chainId: 999999 })).resolves.toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws when the support check fails, instead of reporting the token as unsupported', async () => {
    const customTokenAddress = '0x1111111111111111111111111111111111111111'
    const fetch = (jest.fn() as any).mockResolvedValueOnce(makeResponse({}, false, 500))
    const api = new CowSwapAPI({ fetch, apiKey: cowSwapApiKey })

    await expect(api.isTokenSupported({ address: customTokenAddress, chainId: 1 })).rejects.toThrow(
      'Unable to check whether the token is supported'
    )
  })

  describe('token list cache', () => {
    const listedToken = {
      address: safeTokenAddress,
      chainId: 1,
      decimals: 18,
      name: 'Safe',
      symbol: 'SAFE'
    }

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('reuses the fetched token list for the token list and for lookups by address', async () => {
      const fetch = jest.fn(async () => makeResponse({ tokens: [listedToken] }))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      await api.getToTokenList({ fromChainId: 1, toChainId: 1 })
      await api.getToTokenList({ fromChainId: 1, toChainId: 1 })
      await expect(api.getToken({ address: safeTokenAddress, chainId: 1 })).resolves.toMatchObject({
        symbol: 'SAFE'
      })

      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('shares one request between simultaneous callers', async () => {
      const fetch = jest.fn(async () => makeResponse({ tokens: [listedToken] }))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      await Promise.all([
        api.getToTokenList({ fromChainId: 1, toChainId: 1 }),
        api.getToken({ address: safeTokenAddress, chainId: 1 })
      ])

      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('does not cache a failed request', async () => {
      const fetch = (jest.fn() as any)
        .mockResolvedValueOnce(makeResponse({}, false, 500))
        .mockResolvedValueOnce(makeResponse({ tokens: [listedToken] }))
      const api = new CowSwapAPI({ fetch, apiKey: cowSwapApiKey })

      await expect(api.getToTokenList({ fromChainId: 1, toChainId: 1 })).rejects.toThrow()
      await expect(api.getToTokenList({ fromChainId: 1, toChainId: 1 })).resolves.toContainEqual(
        expect.objectContaining({ symbol: 'SAFE' })
      )
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('fetches the token list again after the cache expires', async () => {
      const now = jest.spyOn(Date, 'now')
      now.mockReturnValue(1_000_000)
      const fetch = jest.fn(async () => makeResponse({ tokens: [listedToken] }))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      await api.getToTokenList({ fromChainId: 1, toChainId: 1 })
      now.mockReturnValue(1_000_000 + COWSWAP_TOKEN_LIST_CACHE_MS - 1)
      await api.getToTokenList({ fromChainId: 1, toChainId: 1 })
      expect(fetch).toHaveBeenCalledTimes(1)

      now.mockReturnValue(1_000_000 + COWSWAP_TOKEN_LIST_CACHE_MS)
      await api.getToTokenList({ fromChainId: 1, toChainId: 1 })
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('does not share the cache between instances', async () => {
      const fetch = jest.fn(async () => makeResponse({ tokens: [listedToken] }))
      const firstApi = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })
      const secondApi = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      await firstApi.getToTokenList({ fromChainId: 1, toChainId: 1 })
      await secondApi.getToTokenList({ fromChainId: 1, toChainId: 1 })

      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })

  it('rejects a cross-chain quote instead of building an order on the source chain', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    await expect(api.quote({ ...makeQuoteParams(), toChainId: 8453 })).rejects.toThrow(
      'CoW Swap supports only same-network swaps'
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requests a PreSign quote, includes the Ambire fee and returns an intent route', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    const result = await api.quote(makeQuoteParams())
    const [url, init] = getOrderBookCalls(fetch)[0]!
    const request = JSON.parse((init as any).body)
    const appData = JSON.parse(request.appData)
    const route = result.routes[0]!

    expect(url).toBe('https://partners.cow.fi/mainnet/api/v1/quote')
    expect((init as any).headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': cowSwapApiKey
    })
    expect(request).toMatchObject({
      signingScheme: 'presign',
      kind: 'sell',
      sellAmountBeforeFee: '1000000',
      from: userAddress,
      receiver: userAddress
    })
    expect(appData).toMatchObject({
      appCode: 'Ambire',
      metadata: {
        partnerFee: {
          recipient: expect.any(String),
          volumeBps: 50
        },
        quote: { slippageBips: 50 }
      },
      version: '1.4.0'
    })
    expect(route.providerId).toBe('cowswap')
    expect(route.isIntent).toBe(true)
    expect(route.routeId).toHaveLength(114)
    expect(route.withConvenienceFee).toBe(true)
    expect((route.rawRoute as any).order).toMatchObject({
      signingScheme: 'presign',
      signature: '0x',
      feeAmount: '0',
      sellAmount: '1000000',
      from: userAddress
    })
    const buyAmountBeforeFees = quotedBuyAmount + networkFeeInBuyToken
    const expectedPartnerFee = (buyAmountBeforeFees * 50n) / 10000n
    const expectedAmountAfterNetworkCost = quotedBuyAmount - expectedPartnerFee
    // the fixed 0.5% for the price, plus the room for the network cost to grow
    const expectedSlippageBps = 50n + networkCostSlippageBps
    const expectedMinAmountOut =
      expectedAmountAfterNetworkCost -
      (expectedAmountAfterNetworkCost * expectedSlippageBps) / 10000n
    expect(route.toAmount).toBe((expectedAmountAfterNetworkCost + networkFeeInBuyToken).toString())
    expect(route.networkFeeInToToken).toBe(networkFeeInBuyToken.toString())
    expect(BigInt(route.toAmount) - BigInt(route.networkFeeInToToken!)).toBe(
      expectedAmountAfterNetworkCost
    )
    expect(route.userTxs[0]!.toAmount).toBe(route.toAmount)
    expect(route.steps[0]!.minAmountOut).toBe(expectedMinAmountOut.toString())
    expect((route.rawRoute as any).order.buyAmount).toBe(expectedMinAmountOut.toString())
    expect(route.outputValueInUsd).toBeCloseTo(Number(formatUnits(route.toAmount, 18)) * 2000, 10)
    expect(route.outputValueAfterGasInUsd).toBeCloseTo(
      Number(formatUnits(expectedAmountAfterNetworkCost, 18)) * 2000,
      10
    )
  })

  it('never lets the order require the network cost that solvers deduct from the output', async () => {
    const api = new CowSwapAPI({ fetch: makeQuoteFetch() as any, apiKey: cowSwapApiKey })

    const route = (await api.quote(makeQuoteParams({ feePercent: 0 }))).routes[0]!
    const orderBuyAmount = BigInt((route.rawRoute as any).order.buyAmount)

    // the displayed amount includes the network cost, but the signed order must stay
    // below what CoW quoted after deducting it, otherwise it can never be filled
    expect(BigInt(route.toAmount)).toBeGreaterThan(quotedBuyAmount)
    expect(orderBuyAmount).toBeLessThan(quotedBuyAmount)
    expect(orderBuyAmount).toBe(
      quotedBuyAmount - (quotedBuyAmount * (50n + networkCostSlippageBps)) / 10000n
    )
    expect(route.outputValueAfterGasInUsd!).toBeLessThan(route.outputValueInUsd)
  })

  it('builds one batchable approval plus on-chain PreSign request without posting early', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })
    const quote = await api.quote(makeQuoteParams())
    const route = quote.routes[0]!

    const transaction = await api.startRoute(route)
    const [orderUid, signed] = settlementInterface.decodeFunctionData(
      'setPreSignature',
      transaction.txData
    )

    expect(getOrderBookCalls(fetch)).toHaveLength(1)
    expect(transaction.approvalData).toEqual({
      allowanceTarget: COWSWAP_VAULT_RELAYER_ADDRESS,
      approvalTokenAddress: tokenIn,
      minimumApprovalAmount: '1000000',
      owner: userAddress
    })
    expect(transaction.txTarget).toBe(COWSWAP_SETTLEMENT_ADDRESS)
    expect(orderUid).toBe(route.routeId)
    expect(signed).toBe(true)
  })

  it('attaches the pre-signed order, which hashes back to the pre-signed order ID', async () => {
    const api = new CowSwapAPI({ fetch: makeQuoteFetch() as any, apiKey: cowSwapApiKey })
    const route = (await api.quote(makeQuoteParams())).routes[0]!
    const rawRoute = route.rawRoute as any

    const transaction = await api.startRoute(route)
    const [orderUid] = settlementInterface.decodeFunctionData('setPreSignature', transaction.txData)

    expect(transaction.cowSwapOrder).toEqual(getCowSwapOrderStruct(rawRoute.order))
    expect(transaction.cowSwapOrder).toMatchObject({
      sellToken: tokenIn,
      buyToken: tokenOut,
      receiver: userAddress,
      sellAmount: '1000000',
      appData: rawRoute.order.appDataHash,
      kind: 'sell',
      partiallyFillable: false
    })
    expect(
      getCowSwapOrderUid({ chainId: 1, order: transaction.cowSwapOrder!, owner: userAddress })
    ).toBe(orderUid)
  })

  it('uses the existing no-fee policy for wrap and unwrap operations', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    const result = await api.quote(makeQuoteParams({ isWrapOrUnwrap: true }))
    const [, init] = getOrderBookCalls(fetch)[0]!
    const request = JSON.parse((init as any).body)

    expect(JSON.parse(request.appData).metadata.partnerFee).toBeUndefined()
    expect(result.routes[0]!.withConvenienceFee).toBe(false)
    expect(result.routes[0]!.feeExemptionReason).toBe('wrap-or-unwrap')
    expect(result.routes[0]!.toAmount).toBe((quotedBuyAmount + networkFeeInBuyToken).toString())
  })

  it('uses the fee percentage supplied for the account', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    const result = await api.quote(makeQuoteParams({ feePercent: 0.25 }))
    const [, init] = getOrderBookCalls(fetch)[0]!
    const request = JSON.parse((init as any).body)
    const buyAmountBeforeFees = quotedBuyAmount + networkFeeInBuyToken
    const expectedPartnerFee = (buyAmountBeforeFees * 25n) / 10000n

    expect(JSON.parse(request.appData).metadata.partnerFee.volumeBps).toBe(25)
    expect(result.routes[0]!.withConvenienceFee).toBe(true)
    expect(result.routes[0]!.toAmount).toBe(
      (quotedBuyAmount - expectedPartnerFee + networkFeeInBuyToken).toString()
    )
  })

  it('does not include a fee when the supplied fee percentage is zero', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    const result = await api.quote(makeQuoteParams({ feePercent: 0 }))
    const [, init] = getOrderBookCalls(fetch)[0]!
    const request = JSON.parse((init as any).body)

    expect(JSON.parse(request.appData).metadata.partnerFee).toBeUndefined()
    expect(result.routes[0]!.withConvenienceFee).toBe(false)
    expect(result.routes[0]!.feeExemptionReason).toBeUndefined()
    expect(result.routes[0]!.toAmount).toBe((quotedBuyAmount + networkFeeInBuyToken).toString())
  })

  it('does not include a fee for fee-exempt tokens', async () => {
    const stEthAddress = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    const result = await api.quote(
      makeQuoteParams({
        fromAsset: {
          ...makeQuoteParams().fromAsset,
          address: stEthAddress,
          symbol: 'stETH'
        },
        fromTokenAddress: stEthAddress
      })
    )
    const [, init] = getOrderBookCalls(fetch)[0]!
    const request = JSON.parse((init as any).body)

    expect(JSON.parse(request.appData).metadata.partnerFee).toBeUndefined()
    expect(result.routes[0]!.withConvenienceFee).toBe(false)
    expect(result.routes[0]!.feeExemptionReason).toBe('fee-exempt-token')
  })

  it('requests an on-chain EIP-1271 quote for a native ETH sell on Base', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    const result = await api.quote(makeEthFlowQuoteParams())
    const [, init] = getOrderBookCalls(fetch)[0]!
    const request = JSON.parse((init as any).body)
    const route = result.routes[0]!

    expect(request).toMatchObject({
      sellToken: baseWeth,
      buyToken: baseUsdc,
      from: userAddress,
      receiver: userAddress,
      signingScheme: 'eip1271',
      onchainOrder: true,
      verificationGasLimit: 0,
      sellAmountBeforeFee: '1000000000000000000'
    })
    expect(route.routeId.toLowerCase()).toMatch(
      new RegExp(`${COWSWAP_ETH_FLOW_ADDRESS.slice(2).toLowerCase()}ffffffff$`)
    )
    expect(route.rawRoute).toMatchObject({
      isEthFlow: true,
      order: {
        sellToken: baseWeth,
        signingScheme: 'eip1271',
        feeAmount: '0',
        sellAmount: '1000000000000000000',
        quoteId: 7
      }
    })
  })

  it('uploads AppData and builds a payable ETH Flow createOrder transaction', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })
    const quote = await api.quote(makeEthFlowQuoteParams())
    const route = quote.routes[0]!

    const transaction = await api.startRoute(route)
    const [ethFlowOrder] = ethFlowInterface.decodeFunctionData('createOrder', transaction.txData)
    const [uploadUrl, uploadInit] = getOrderBookCalls(fetch)[1]!
    const rawRoute = route.rawRoute as any

    expect(uploadUrl).toContain(`/app_data/${rawRoute.order.appDataHash}`)
    expect(uploadInit).toMatchObject({ method: 'PUT' })
    expect(JSON.parse((uploadInit as any).body)).toEqual({
      fullAppData: rawRoute.order.appData
    })
    expect(transaction).toMatchObject({
      activeRouteId: route.routeId,
      approvalData: null,
      chainId: 8453,
      txTarget: COWSWAP_ETH_FLOW_ADDRESS,
      value: '1000000000000000000'
    })
    expect(ethFlowOrder.buyToken).toBe(baseUsdc)
    expect(ethFlowOrder.receiver).toBe(userAddress)
    expect(ethFlowOrder.sellAmount).toBe(1000000000000000000n)
    expect(ethFlowOrder.buyAmount.toString()).toBe(rawRoute.order.buyAmount)
    expect(ethFlowOrder.appData).toBe(rawRoute.order.appDataHash)
    expect(ethFlowOrder.feeAmount).toBe(0n)
    expect(ethFlowOrder.validTo).toBe(BigInt(rawRoute.order.validTo))
    expect(ethFlowOrder.partiallyFillable).toBe(false)
    expect(ethFlowOrder.quoteId).toBe(7n)
    // the ETH Flow calldata already contains the whole order, so nothing is attached
    expect(transaction.cowSwapOrder).toBeUndefined()
  })

  it('waits for the order service to index a newly mined ETH Flow order', async () => {
    const route = await makeEthFlowRouteFixture()
    const fetch = jest.fn(async () => makeResponse({}, false, 404))
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    await expect(
      api.getRouteStatus({
        txHash: '0x1',
        fromChainId: 8453,
        toChainId: 8453,
        routeId: route.routeId,
        rawRoute: route.rawRoute
      })
    ).resolves.toEqual({ status: null })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a changed ETH Flow quote id before uploading AppData', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })
    const quote = await api.quote(makeEthFlowQuoteParams())
    const route = quote.routes[0]!
    ;(route.rawRoute as any).order.quoteId = 8

    await expect(api.startRoute(route)).rejects.toThrow('ETH order details changed')
    expect(getOrderBookCalls(fetch)).toHaveLength(1)
  })

  it('rejects quote details that do not match the requested AppData', async () => {
    const fetch = jest.fn(async (url: any, init: any) => {
      if (isSmartSlippageUrl(url)) return makeResponse({ slippageBps: 0 })

      const request = JSON.parse(init.body)
      return makeResponse({
        quote: {
          sellToken: request.sellToken,
          buyToken: request.buyToken,
          receiver: request.receiver,
          sellAmount: '990000',
          buyAmount: '500000000000000',
          validTo: Math.floor(Date.now() / 1000) + 1800,
          appData: request.appData,
          appDataHash: `0x${'00'.repeat(32)}`,
          feeAmount: '10000',
          gasAmount: '150000',
          gasPrice: '1',
          sellTokenPrice: '1',
          kind: 'sell',
          partiallyFillable: false,
          signingScheme: request.signingScheme
        },
        expiration: new Date(Date.now() + 60000).toISOString(),
        id: 7,
        verified: true
      })
    })
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    await expect(api.quote(makeQuoteParams())).rejects.toThrow(
      'order details that do not match your request'
    )
  })

  it('waits to submit the order while the batched approval is not mined', async () => {
    const route = await makeRouteFixture()
    const fetch = (jest.fn() as any)
      .mockResolvedValueOnce(makeResponse({}, false, 404))
      .mockResolvedValueOnce(
        makeResponse(
          { errorType: 'InsufficientAllowance', description: 'Not enough allowance' },
          false,
          400
        )
      )
    const api = new CowSwapAPI({ fetch, apiKey: cowSwapApiKey })

    await expect(
      api.getRouteStatus({
        txHash: '0x1',
        fromChainId: 1,
        toChainId: 1,
        routeId: route.routeId,
        rawRoute: route.rawRoute
      })
    ).resolves.toEqual({ status: null })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('submits a missing order after approval and continues tracking it', async () => {
    const route = await makeRouteFixture()
    const fetch = (jest.fn() as any)
      .mockResolvedValueOnce(makeResponse({}, false, 404))
      .mockResolvedValueOnce(makeResponse(route.routeId, true, 201))
      .mockResolvedValueOnce(makeResponse({ status: 'open' }))
    const api = new CowSwapAPI({ fetch, apiKey: cowSwapApiKey })

    await expect(
      api.getRouteStatus({
        txHash: '0x1',
        fromChainId: 1,
        toChainId: 1,
        routeId: route.routeId,
        rawRoute: route.rawRoute
      })
    ).resolves.toEqual({ status: null })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('reports the solver settlement transaction when an order is fulfilled', async () => {
    const settlementTxHash = `0x${'11'.repeat(32)}`
    const fetch = (jest.fn() as any)
      .mockResolvedValueOnce(makeResponse({ status: 'fulfilled' }))
      .mockResolvedValueOnce(makeResponse([{ txHash: settlementTxHash }]))
    const api = new CowSwapAPI({ fetch, apiKey: cowSwapApiKey })

    await expect(
      api.getRouteStatus({
        txHash: '0x1',
        fromChainId: 1,
        toChainId: 1,
        routeId: 'order-uid',
        rawRoute: { order: {} } as any
      })
    ).resolves.toEqual({ status: 'completed', txnId: settlementTxHash })
    expect(fetch.mock.calls[1]![0]).toBe(
      'https://partners.cow.fi/mainnet/api/v2/trades?orderUid=order-uid&limit=10'
    )
  })

  it('reports expired orders as failed intents', async () => {
    const fetch = jest.fn(async () => makeResponse({ status: 'expired' }))
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    await expect(
      api.getRouteStatus({
        txHash: '0x1',
        fromChainId: 1,
        toChainId: 1,
        routeId: 'order-uid',
        rawRoute: { order: {} } as any
      })
    ).resolves.toEqual({ status: 'failed' })
  })

  it('fails safely if CoW returns a different UID for the approved order', async () => {
    const route = await makeRouteFixture()
    const fetch = (jest.fn() as any)
      .mockResolvedValueOnce(makeResponse({}, false, 404))
      .mockResolvedValueOnce(makeResponse('different-order-uid', true, 201))
    const api = new CowSwapAPI({ fetch, apiKey: cowSwapApiKey })

    await expect(
      api.getRouteStatus({
        txHash: '0x1',
        fromChainId: 1,
        toChainId: 1,
        routeId: route.routeId,
        rawRoute: route.rawRoute
      })
    ).rejects.toThrow('identifier did not match the approved order')
  })

  describe('slippage', () => {
    /** A USDC sell worth `usd`, where the fixed slippage gets smaller from $400 up */
    const makeTradeQuoteParams = (usd: bigint) =>
      makeQuoteParams({
        fromAsset: { ...makeQuoteParams().fromAsset, amount: usd * 1_000_000n },
        fromAmount: usd * 1_000_000n
      })

    /** The slippage in the AppData of the order that the user signs */
    const getOrderSlippageBps = (route: SwapAndBridgeRoute) =>
      BigInt(JSON.parse((route.rawRoute as any).order.appData).metadata.quote.slippageBips)

    const getMinAmountOut = (slippageBps: bigint) => {
      const expectedPartnerFee = ((quotedBuyAmount + networkFeeInBuyToken) * 50n) / 10000n
      const amountAfterNetworkCost = quotedBuyAmount - expectedPartnerFee
      return amountAfterNetworkCost - (amountAfterNetworkCost * slippageBps) / 10000n
    }

    /** Checks that the order allows `priceSlippageBps` plus the room for the network cost */
    const expectOrderSlippage = (route: SwapAndBridgeRoute, priceSlippageBps: bigint) => {
      const slippageBps = priceSlippageBps + networkCostSlippageBps
      expect(getOrderSlippageBps(route)).toBe(slippageBps)
      expect(route.userTxs[0]!.swapSlippage).toBe(Number(slippageBps) / 100)
      expect(route.userTxs[0]!.minAmountOut).toBe(getMinAmountOut(slippageBps).toString())
      expect((route.rawRoute as any).order.buyAmount).toBe(getMinAmountOut(slippageBps).toString())
    }

    afterEach(() => {
      jest.restoreAllMocks()
      jest.useRealTimers()
    })

    it('asks CoW Swap for the slippage of the pair, without sending the API key', async () => {
      const fetch = makeQuoteFetch(async () => makeResponse({ slippageBps: 73 }))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      await api.quote(makeQuoteParams())
      const smartSlippageCalls = getSmartSlippageCalls(fetch)

      expect(smartSlippageCalls).toHaveLength(1)
      expect(smartSlippageCalls[0]![0]).toBe(
        `https://bff.cow.fi/1/markets/${tokenIn}-${tokenOut}/slippageTolerance`
      )
      expect(smartSlippageCalls[0]![1].headers).not.toHaveProperty('X-API-Key')
    })

    it('requests the quote without waiting for the slippage of the pair', async () => {
      let respondWithSlippage: (response: unknown) => void = () => {}
      const fetch = makeQuoteFetch(
        () =>
          new Promise((resolve) => {
            respondWithSlippage = resolve
          })
      )
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      const quote = api.quote(makeQuoteParams())
      await Promise.resolve()

      expect(getOrderBookCalls(fetch)).toHaveLength(1)
      respondWithSlippage(makeResponse({ slippageBps: 73 }))
      expectOrderSlippage((await quote).routes[0]!, 73n)
    })

    it('signs an order whose AppData differs from the quoted one only in the slippage', async () => {
      const fetch = makeQuoteFetch(async () => makeResponse({ slippageBps: 73 }))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      const route = (await api.quote(makeQuoteParams())).routes[0]!
      const { order } = route.rawRoute as any
      const [, quoteInit] = getOrderBookCalls(fetch)[0]!
      const quoteRequest = JSON.parse(quoteInit.body)
      const quotedAppData = JSON.parse(quoteRequest.appData)
      const orderAppData = JSON.parse(order.appData)

      expect(quotedAppData.metadata.quote.slippageBips).toBe(50)
      expect(orderAppData).toEqual({
        ...quotedAppData,
        metadata: { ...quotedAppData.metadata, quote: { slippageBips: 73 + 51 } }
      })
      expect(order.appDataHash).toBe(keccak256(toUtf8Bytes(order.appData)))
      expect(order.appDataHash).not.toBe(quoteRequest.appDataHash)
      expect(route.routeId).toBe(
        getCowSwapOrderUid({ chainId: 1, order: getCowSwapOrderStruct(order), owner: userAddress })
      )
      expect(order.quoteId).toBe(7)
    })

    it('leaves room for the network cost to grow by half', async () => {
      const api = new CowSwapAPI({ fetch: makeQuoteFetch() as any, apiKey: cowSwapApiKey })

      const route = (await api.quote(makeQuoteParams())).routes[0]!

      expectOrderSlippage(route, 50n)
    })

    it('raises the slippage of a small trade on a volatile pair', async () => {
      const api = new CowSwapAPI({
        fetch: makeQuoteFetch(async () => makeResponse({ slippageBps: 73 })) as any,
        apiKey: cowSwapApiKey
      })

      expectOrderSlippage((await api.quote(makeQuoteParams())).routes[0]!, 73n)
    })

    it('lowers the slippage of a stable pair', async () => {
      const api = new CowSwapAPI({
        fetch: makeQuoteFetch(async () => makeResponse({ slippageBps: 2 })) as any,
        apiKey: cowSwapApiKey
      })

      expectOrderSlippage((await api.quote(makeQuoteParams())).routes[0]!, 2n)
    })

    it('never lets a small trade use more than 1% slippage for the price', async () => {
      const api = new CowSwapAPI({
        fetch: makeQuoteFetch(async () => makeResponse({ slippageBps: 5000 })) as any,
        apiKey: cowSwapApiKey
      })

      expectOrderSlippage((await api.quote(makeQuoteParams())).routes[0]!, 100n)
    })

    it('never raises the slippage of a large trade above the fixed one', async () => {
      const api = new CowSwapAPI({
        fetch: makeQuoteFetch(async () => makeResponse({ slippageBps: 45 })) as any,
        apiKey: cowSwapApiKey
      })

      const route = (await api.quote(makeTradeQuoteParams(100_000n))).routes[0]!

      // the fixed slippage of a $100k trade is 0.1%
      expect(getOrderSlippageBps(route)).toBe(10n + networkCostSlippageBps)
    })

    it('lowers the slippage of a large trade on a stable pair', async () => {
      const api = new CowSwapAPI({
        fetch: makeQuoteFetch(async () => makeResponse({ slippageBps: 2 })) as any,
        apiKey: cowSwapApiKey
      })

      const route = (await api.quote(makeTradeQuoteParams(100_000n))).routes[0]!

      expect(getOrderSlippageBps(route)).toBe(2n + networkCostSlippageBps)
    })

    it('keeps some slippage for the price on very large trades', async () => {
      const api = new CowSwapAPI({ fetch: makeQuoteFetch() as any, apiKey: cowSwapApiKey })

      const route = (await api.quote(makeTradeQuoteParams(5_000_000n))).routes[0]!

      // the fixed slippage of a $5M trade is 0.002%, which rounds to 0 bps
      expect(getOrderSlippageBps(route)).toBe(1n + networkCostSlippageBps)
    })

    it('does not raise the slippage when the value of the trade is unknown', async () => {
      const api = new CowSwapAPI({
        fetch: makeQuoteFetch(async () => makeResponse({ slippageBps: 73 })) as any,
        apiKey: cowSwapApiKey
      })

      const route = (
        await api.quote(
          makeQuoteParams({ fromAsset: { ...makeQuoteParams().fromAsset, priceIn: [] } })
        )
      ).routes[0]!

      expectOrderSlippage(route, 50n)
    })

    it.each([
      ['no market data', async () => makeResponse({ slippageBps: 0 })],
      ['a negative slippage', async () => makeResponse({ slippageBps: -10 })],
      ['a fractional slippage', async () => makeResponse({ slippageBps: 12.5 })],
      ['a slippage that is not a number', async () => makeResponse({ slippageBps: '73' })],
      ['a missing slippage', async () => makeResponse({})],
      ['a response that is not an object', async () => makeResponse(null)],
      ['an error response', async () => makeResponse({ message: 'Bad Request' }, false, 400)],
      ['rate limiting', async () => makeResponse({}, false, 429)],
      [
        'an unreadable response',
        async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('Unexpected token')
          }
        })
      ],
      [
        'a network error',
        async () => {
          throw new Error('Network request failed')
        }
      ]
    ])('falls back to the fixed slippage on %s', async (_, smartSlippageResponse) => {
      const api = new CowSwapAPI({
        fetch: makeQuoteFetch(smartSlippageResponse) as any,
        apiKey: cowSwapApiKey
      })

      expectOrderSlippage((await api.quote(makeQuoteParams())).routes[0]!, 50n)
    })

    it('does not hold the quote for long when the slippage endpoint is slow', async () => {
      jest.useFakeTimers()
      const fetch = makeQuoteFetch(() => new Promise(() => {}))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      const quote = api.quote(makeQuoteParams())
      await jest.advanceTimersByTimeAsync(COWSWAP_SMART_SLIPPAGE_TIMEOUT_MS)

      expectOrderSlippage((await quote).routes[0]!, 50n)
      expect(jest.getTimerCount()).toBe(0)
    })

    it('looks up the market of the wrapped native token when buying the native token', async () => {
      const fetch = makeQuoteFetch(async () => makeResponse({ slippageBps: 45 }))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      const route = (
        await api.quote(
          makeQuoteParams({
            toAsset: { ...makeQuoteParams().toAsset, address: ZeroAddress, symbol: 'ETH' },
            toTokenAddress: ZeroAddress
          })
        )
      ).routes[0]!

      expect(getSmartSlippageCalls(fetch)[0]![0]).toBe(
        `https://bff.cow.fi/1/markets/${tokenIn}-${tokenOut}/slippageTolerance`
      )
      // the order itself still buys the native token
      expect((route.rawRoute as any).order.buyToken).toBe(COWSWAP_BUY_NATIVE_TOKEN_ADDRESS)
    })

    it('looks up the market of the wrapped native token when selling the native token', async () => {
      const fetch = makeQuoteFetch(async () => makeResponse({ slippageBps: 45 }))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      await api.quote(makeEthFlowQuoteParams())

      expect(getSmartSlippageCalls(fetch)[0]![0]).toBe(
        `https://bff.cow.fi/8453/markets/${baseWeth}-${baseUsdc}/slippageTolerance`
      )
    })

    it('reuses the slippage of a pair until it expires', async () => {
      const now = jest.spyOn(Date, 'now')
      now.mockReturnValue(1_000_000)
      const fetch = makeQuoteFetch(async () => makeResponse({ slippageBps: 73 }))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      await api.quote(makeQuoteParams())
      now.mockReturnValue(1_000_000 + COWSWAP_SMART_SLIPPAGE_CACHE_MS - 1)
      expectOrderSlippage((await api.quote(makeQuoteParams())).routes[0]!, 73n)
      expect(getSmartSlippageCalls(fetch)).toHaveLength(1)

      now.mockReturnValue(1_000_000 + COWSWAP_SMART_SLIPPAGE_CACHE_MS)
      await api.quote(makeQuoteParams())
      expect(getSmartSlippageCalls(fetch)).toHaveLength(2)
    })

    it('shares one request between simultaneous quotes for a pair', async () => {
      const fetch = makeQuoteFetch(async () => makeResponse({ slippageBps: 73 }))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      const routes = await Promise.all([api.quote(makeQuoteParams()), api.quote(makeQuoteParams())])

      expect(getSmartSlippageCalls(fetch)).toHaveLength(1)
      routes.forEach(({ routes: [route] }) => expectOrderSlippage(route!, 73n))
    })

    it('keeps the slippage of each pair apart', async () => {
      const fetch = makeQuoteFetch(async () => makeResponse({ slippageBps: 73 }))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      await api.quote(makeQuoteParams())
      await api.quote(
        makeQuoteParams({
          toAsset: { ...makeQuoteParams().toAsset, address: safeTokenAddress, symbol: 'SAFE' },
          toTokenAddress: safeTokenAddress
        })
      )

      expect(getSmartSlippageCalls(fetch)).toHaveLength(2)
    })

    it('asks again shortly after a failure, but not on every quote', async () => {
      const now = jest.spyOn(Date, 'now')
      now.mockReturnValue(1_000_000)
      const smartSlippageResponse = (jest.fn() as any)
        .mockRejectedValueOnce(new Error('Network request failed'))
        .mockResolvedValue(makeResponse({ slippageBps: 73 }))
      const fetch = makeQuoteFetch(smartSlippageResponse)
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

      await api.quote(makeQuoteParams())
      now.mockReturnValue(1_000_000 + COWSWAP_SMART_SLIPPAGE_FAILURE_CACHE_MS - 1)
      expectOrderSlippage((await api.quote(makeQuoteParams())).routes[0]!, 50n)
      expect(getSmartSlippageCalls(fetch)).toHaveLength(1)

      now.mockReturnValue(1_000_000 + COWSWAP_SMART_SLIPPAGE_FAILURE_CACHE_MS)
      expectOrderSlippage((await api.quote(makeQuoteParams())).routes[0]!, 73n)
      expect(getSmartSlippageCalls(fetch)).toHaveLength(2)
    })
  })

  it('rejects a tampered route before creating transaction calldata', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })
    const quote = await api.quote(makeQuoteParams())
    const route = { ...quote.routes[0]!, routeId: `0x${'00'.repeat(56)}` } as SwapAndBridgeRoute

    await expect(api.startRoute(route)).rejects.toThrow('order details changed')
  })
})
