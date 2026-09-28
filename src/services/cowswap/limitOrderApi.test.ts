import { Interface, ZeroAddress } from 'ethers'

import { describe, expect, it, jest } from '@jest/globals'

import { FEE_COLLECTOR } from '../../consts/addresses'
import { LimitOrderAPI } from './limitOrderApi'
import { COWSWAP_ETH_FLOW_ADDRESS, COWSWAP_SETTLEMENT_ADDRESS } from './constants'

const userAddress = '0x0000000000000000000000000000000000000001'
const sellToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const buyToken = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const baseUsdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const cowSwapApiKey = 'cow-swap-api-key'

const makeResponse = (body: any, ok = true, status = ok ? 200 : 400) => ({
  ok,
  status,
  json: async () => body
})

const makeFromToken = (overrides: Record<string, unknown> = {}) =>
  ({
    address: sellToken,
    amount: 2_000_000n,
    chainId: 1n,
    decimals: 6,
    flags: { canTopUpGasTank: false, isFeeToken: false, onGasTank: false, rewardsType: null },
    marketDataIn: [],
    name: 'USD Coin',
    priceIn: [],
    symbol: 'USDC',
    ...overrides
  }) as any

const makeToToken = (overrides: Record<string, unknown> = {}) => ({
  address: buyToken,
  chainId: 1,
  decimals: 18,
  icon: '',
  name: 'Wrapped Ether',
  symbol: 'WETH',
  ...overrides
})

const makeQuoteFetch = () =>
  jest.fn(async (_url: any, init: any = {}) => {
    const request = init.body ? JSON.parse(init.body) : null
    if (init.method === 'PUT') return makeResponse({ fullAppData: request.fullAppData })

    return makeResponse({
      quote: {
        sellToken: request.sellToken,
        buyToken: request.buyToken,
        receiver: request.receiver,
        sellAmount: request.sellAmountBeforeFee,
        buyAmount: '1100000000000000000',
        validTo: request.validTo || Math.floor(Date.now() / 1000) + request.validFor,
        appData: request.appData,
        appDataHash: request.appDataHash,
        feeAmount: '0',
        gasAmount: '150000',
        gasPrice: '1000000000',
        sellTokenPrice: '1',
        kind: 'sell',
        partiallyFillable: request.partiallyFillable,
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20',
        signingScheme: request.signingScheme
      },
      from: request.from,
      expiration: new Date(Date.now() + 60000).toISOString(),
      id: 7,
      verified: true
    })
  })

describe('LimitOrderAPI', () => {
  it('gets a market quote before a limit price is selected', async () => {
    const fetch = makeQuoteFetch()
    const api = new LimitOrderAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    const result = await api.getMarketQuote({
      fromToken: makeFromToken(),
      toToken: makeToToken(),
      fromAmount: 2_000_000n,
      owner: userAddress,
      feePercent: 0.5
    })

    const quoteRequest = JSON.parse(fetch.mock.calls[0]![1]!.body)
    const appData = JSON.parse(quoteRequest.appData)

    expect(quoteRequest.validFor).toBe(30 * 60)
    expect(quoteRequest.validTo).toBeUndefined()
    expect(appData.metadata.orderClass).toEqual({ orderClass: 'market' })
    expect(result.currentMarketBuyAmount).toBe('1094500000000000000')
  })

  it('prepares a fill-or-kill limit order whose buy amount is the user net minimum', async () => {
    const fetch = makeQuoteFetch()
    const api = new LimitOrderAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })
    const targetBuyAmount = 1_250_000_000_000_000_000n

    const result = await api.prepareOrder({
      fromToken: makeFromToken(),
      toToken: makeToToken(),
      fromAmount: 2_000_000n,
      targetBuyAmount,
      owner: userAddress,
      validTo: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      feePercent: 0.5
    })

    const quoteRequest = JSON.parse(fetch.mock.calls[0]![1]!.body)
    const appData = JSON.parse(result.order.appData)

    expect(quoteRequest.partiallyFillable).toBe(false)
    expect(result.order.partiallyFillable).toBe(false)
    expect(result.order.buyAmount).toBe(targetBuyAmount.toString())
    expect(result.order.feeAmount).toBe('0')
    expect(result.order.signingScheme).toBe('presign')
    expect(result.userTx.txTarget).toBe(COWSWAP_SETTLEMENT_ADDRESS)
    expect(appData.metadata.orderClass).toEqual({ orderClass: 'limit' })
    expect(appData.metadata.partnerFee).toEqual({ recipient: FEE_COLLECTOR, volumeBps: 50 })
    expect(appData.metadata.quote).toBeUndefined()
  })

  it('rejects cross-network orders before calling CoW Swap', async () => {
    const fetch = makeQuoteFetch()
    const api = new LimitOrderAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    await expect(
      api.prepareOrder({
        fromToken: makeFromToken(),
        toToken: makeToToken({ chainId: 8453 }),
        fromAmount: 2_000_000n,
        targetBuyAmount: 1n,
        owner: userAddress,
        validTo: Math.floor(Date.now() / 1000) + 3600,
        feePercent: 0.5
      })
    ).rejects.toThrow('same network')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the on-chain ETH flow with the same fill-or-kill target', async () => {
    const fetch = makeQuoteFetch()
    const api = new LimitOrderAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })
    const targetBuyAmount = 3_800_000_000n

    const result = await api.prepareOrder({
      fromToken: makeFromToken({
        address: ZeroAddress,
        chainId: 8453n,
        decimals: 18,
        symbol: 'ETH'
      }),
      toToken: makeToToken({
        address: baseUsdc,
        chainId: 8453,
        decimals: 6,
        symbol: 'USDC'
      }),
      fromAmount: 1_000_000_000_000_000_000n,
      targetBuyAmount,
      owner: userAddress,
      validTo: Math.floor(Date.now() / 1000) + 3600,
      feePercent: 0.5
    })

    const ethFlowInterface = new Interface([
      'function createOrder((address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,bytes32 appData,uint256 feeAmount,uint32 validTo,bool partiallyFillable,int64 quoteId) order) payable returns (bytes32 orderHash)'
    ])
    const decoded = ethFlowInterface.decodeFunctionData('createOrder', result.userTx.txData)

    expect(result.isEthFlow).toBe(true)
    expect(result.userTx.txTarget).toBe(COWSWAP_ETH_FLOW_ADDRESS)
    expect(decoded.order.buyAmount).toBe(targetBuyAmount)
    expect(decoded.order.partiallyFillable).toBe(false)
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true)
  })

  it('rejects a quote that changes the fill behavior', async () => {
    const fetch = makeQuoteFetch()
    fetch.mockImplementationOnce(async (_url: any, init: any) => {
      const request = JSON.parse(init.body)
      return makeResponse({
        quote: {
          sellToken: request.sellToken,
          buyToken: request.buyToken,
          receiver: request.receiver,
          sellAmount: request.sellAmountBeforeFee,
          buyAmount: '1',
          validTo: Math.floor(Date.now() / 1000) + 3600,
          appData: request.appData,
          feeAmount: '0',
          kind: 'sell',
          partiallyFillable: true,
          signingScheme: 'presign'
        },
        id: 7
      })
    })
    const api = new LimitOrderAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    await expect(
      api.prepareOrder({
        fromToken: makeFromToken(),
        toToken: makeToToken(),
        fromAmount: 2_000_000n,
        targetBuyAmount: 1n,
        owner: userAddress,
        validTo: Math.floor(Date.now() / 1000) + 3600,
        feePercent: 0.5
      })
    ).rejects.toThrow('unexpected details')
  })

  it('rejects a quote that changes the requested expiration', async () => {
    const fetch = makeQuoteFetch()
    fetch.mockImplementationOnce(async (_url: any, init: any) => {
      const request = JSON.parse(init.body)
      return makeResponse({
        quote: {
          sellToken: request.sellToken,
          buyToken: request.buyToken,
          receiver: request.receiver,
          sellAmount: request.sellAmountBeforeFee,
          buyAmount: '1',
          validTo: request.validTo + 1,
          appData: request.appData,
          appDataHash: request.appDataHash,
          feeAmount: '0',
          kind: 'sell',
          partiallyFillable: false,
          signingScheme: 'presign'
        },
        id: 7
      })
    })
    const api = new LimitOrderAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })

    await expect(
      api.prepareOrder({
        fromToken: makeFromToken(),
        toToken: makeToToken(),
        fromAmount: 2_000_000n,
        targetBuyAmount: 1n,
        owner: userAddress,
        validTo: Math.floor(Date.now() / 1000) + 3600,
        feePercent: 0.5
      })
    ).rejects.toThrow('unexpected details')
  })

  it('submits a pre-signed order and waits until CoW Swap indexes it', async () => {
    const fetch = makeQuoteFetch()
    const api = new LimitOrderAPI({ fetch: fetch as any, apiKey: cowSwapApiKey })
    const prepared = await api.prepareOrder({
      fromToken: makeFromToken(),
      toToken: makeToToken(),
      fromAmount: 2_000_000n,
      targetBuyAmount: 1_250_000_000_000_000_000n,
      owner: userAddress,
      validTo: Math.floor(Date.now() / 1000) + 3600,
      feePercent: 0.5
    })
    let orderLookups = 0
    fetch.mockImplementation(async (url: any, init: any = {}) => {
      if (init.method === 'POST') return makeResponse(prepared.orderUid)
      if (String(url).includes(`/orders/${prepared.orderUid}`)) {
        orderLookups += 1
        return orderLookups === 1
          ? makeResponse({}, false, 404)
          : makeResponse({ uid: prepared.orderUid })
      }
      throw new Error(`Unexpected request: ${String(url)}`)
    })

    await expect(api.tryPlaceOrder(prepared)).resolves.toBe(true)
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true)
  })
})
