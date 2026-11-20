import { keccak256, toUtf8Bytes, ZeroAddress } from 'ethers'

import { describe, expect, it, jest } from '@jest/globals'

import { FEE_COLLECTOR } from '../../consts/addresses'
import { CowSwapOrderCreation } from '../../interfaces/swapAndBridge'
import { CowSwapAPI } from './api'
import { COWSWAP_APP_CODE } from './constants'
import {
  buildAppData,
  buildLimitOrderAppData,
  computeOrderUid,
  getEthFlowOrderData,
  getPartnerFeeBpsFromAppData,
  isAmbireLimitOrderAppData,
  isCowSwapAccountOrder,
  sortCowSwapTokensByPopularity
} from './helper'

const userAddress = '0x0000000000000000000000000000000000000001'
const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const apiKey = 'cow-swap-api-key'

const makeResponse = (body: any, ok = true, status = ok ? 200 : 400) => ({
  ok,
  status,
  json: async () => body
})

/** The buy amount CoW Swap quotes after its network cost in the fixture below */
const quotedBuyAmount = 500000000000000n

/** Quotes 1% of the sell amount as the network cost, like the swap tests */
const makeQuoteFetch = (overrides: Record<string, unknown> = {}) =>
  jest.fn(async (_url: any, init: any) => {
    const request = JSON.parse(init.body)
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
        kind: 'sell',
        partiallyFillable: false,
        signingScheme: request.signingScheme,
        ...overrides
      },
      id: 7,
      protocolFeeBps: '0'
    })
  })

const makeOrder = (overrides: Partial<CowSwapOrderCreation> = {}): CowSwapOrderCreation => {
  const { fullAppData, appDataHash } = buildLimitOrderAppData({ feeBps: 50 })

  return {
    sellToken: usdc,
    buyToken: weth,
    receiver: userAddress,
    sellAmount: '1000000',
    buyAmount: '600000000000000',
    validTo: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    appData: fullAppData,
    appDataHash,
    feeAmount: '0',
    kind: 'sell',
    partiallyFillable: true,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20',
    signingScheme: 'presign',
    signature: '0x',
    from: userAddress,
    quoteId: null,
    ...overrides
  }
}

const makeAccountOrder = (overrides: Record<string, unknown> = {}) => ({
  uid: `0x${'11'.repeat(56)}`,
  status: 'open',
  sellToken: usdc,
  buyToken: weth,
  receiver: userAddress,
  sellAmount: '1000000',
  buyAmount: '600000000000000',
  validTo: 1900000000,
  appData: buildLimitOrderAppData({ feeBps: 50 }).appDataHash,
  fullAppData: buildLimitOrderAppData({ feeBps: 50 }).fullAppData,
  feeAmount: '0',
  kind: 'sell',
  partiallyFillable: true,
  creationDate: '2026-11-20T10:00:00.000Z',
  executedSellAmount: '0',
  executedBuyAmount: '0',
  invalidated: false,
  ...overrides
})

describe('CoW Swap limit order helpers', () => {
  it('builds limit order app data with the Ambire fee and without a slippage', () => {
    const { fullAppData, appDataHash } = buildLimitOrderAppData({ feeBps: 50 })
    const appData = JSON.parse(fullAppData)

    expect(appData.appCode).toBe(COWSWAP_APP_CODE)
    expect(appData.metadata.orderClass).toEqual({ orderClass: 'limit' })
    expect(appData.metadata.partnerFee).toEqual({ recipient: FEE_COLLECTOR, volumeBps: 50 })
    expect(appData.metadata.quote).toBeUndefined()
    expect(appDataHash).toBe(keccak256(toUtf8Bytes(fullAppData)))
  })

  it('leaves the fee out of limit order app data when there is none', () => {
    const { fullAppData } = buildLimitOrderAppData({})

    expect(JSON.parse(fullAppData).metadata.partnerFee).toBeUndefined()
  })

  it('recognizes only Ambire limit orders by their app data', () => {
    expect(isAmbireLimitOrderAppData(buildLimitOrderAppData({ feeBps: 50 }).fullAppData)).toBe(true)
    // An Ambire swap is a CoW Swap order too, but not a limit order
    expect(isAmbireLimitOrderAppData(buildAppData({ slippageBps: 50 }).fullAppData)).toBe(false)
    expect(
      isAmbireLimitOrderAppData(
        JSON.stringify({ appCode: 'CoW Swap', metadata: { orderClass: { orderClass: 'limit' } } })
      )
    ).toBe(false)
    expect(isAmbireLimitOrderAppData('not json')).toBe(false)
    expect(isAmbireLimitOrderAppData(JSON.stringify(null))).toBe(false)
    expect(isAmbireLimitOrderAppData(null)).toBe(false)
  })

  it('accepts complete account orders and rejects malformed ones', () => {
    expect(isCowSwapAccountOrder(makeAccountOrder())).toBe(true)
    expect(isCowSwapAccountOrder(makeAccountOrder({ sellToken: 'not an address' }))).toBe(false)
    expect(isCowSwapAccountOrder(makeAccountOrder({ executedSellAmount: undefined }))).toBe(false)
    expect(isCowSwapAccountOrder(makeAccountOrder({ buyAmount: 'abc' }))).toBe(false)
    expect(isCowSwapAccountOrder(makeAccountOrder({ validTo: '1900000000' }))).toBe(false)
    expect(isCowSwapAccountOrder(null)).toBe(false)
  })

  it('rebuilds the ETH-flow order data with the real expiry of the order', () => {
    const order = makeAccountOrder({
      validTo: 2 ** 32 - 1,
      receiver: null,
      partiallyFillable: false,
      ethflowData: { userValidTo: 1900000000 }
    })
    if (!isCowSwapAccountOrder(order)) throw new Error('Invalid fixture')

    expect(getEthFlowOrderData(order)).toEqual({
      buyToken: weth,
      receiver: ZeroAddress,
      sellAmount: '1000000',
      buyAmount: '600000000000000',
      appData: order.appData,
      feeAmount: '0',
      validTo: 1900000000,
      partiallyFillable: false,
      quoteId: 0
    })
  })

  it('reads the Ambire fee an order carries from its app data', () => {
    expect(getPartnerFeeBpsFromAppData(buildLimitOrderAppData({ feeBps: 40 }).fullAppData)).toBe(40)
    expect(getPartnerFeeBpsFromAppData(buildLimitOrderAppData({}).fullAppData)).toBe(0)
    expect(
      getPartnerFeeBpsFromAppData(JSON.stringify({ metadata: { partnerFee: { volumeBps: -5 } } }))
    ).toBe(0)
    expect(getPartnerFeeBpsFromAppData('not json')).toBe(0)
    expect(getPartnerFeeBpsFromAppData(null)).toBe(0)
  })

  it('lists the native token, its wrapped version and popular tokens first, then by symbol', () => {
    const token = (symbol: string, address: string) => ({ symbol, address })
    const sorted = sortCowSwapTokensByPopularity(
      [
        token('variableDebtEthUSDT', '0x0000000000000000000000000000000000000002'),
        token('ZRX', '0x0000000000000000000000000000000000000003'),
        token('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7'),
        token('WETH', weth),
        token('AAVE', '0x0000000000000000000000000000000000000004'),
        token('USDC', usdc),
        token('ETH', ZeroAddress)
      ],
      1
    )

    expect(sorted.map(({ symbol }) => symbol)).toEqual([
      'ETH',
      'WETH',
      'USDC',
      'USDT',
      'AAVE',
      'variableDebtEthUSDT',
      'ZRX'
    ])
  })

  it('has no ETH-flow order data for a regular order', () => {
    const order = makeAccountOrder()
    if (!isCowSwapAccountOrder(order)) throw new Error('Invalid fixture')

    expect(getEthFlowOrderData(order)).toBeNull()
  })
})

describe('CowSwapAPI limit orders', () => {
  describe('getLimitOrderMarketQuote', () => {
    it('quotes a pre-sign limit order and returns the amount after the costs and the Ambire fee', async () => {
      const fetch = makeQuoteFetch()
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey })

      const { buyAmount, buyAmountBeforeFees, networkFee, protocolFeeBps, quoteId } =
        await api.getLimitOrderMarketQuote({
        chainId: 1,
        sellToken: usdc,
        buyToken: weth,
        sellAmount: 1000000n,
        owner: userAddress,
        feeBps: 50
      })

      const request = JSON.parse((fetch.mock.calls[0] as any)[1].body)
      expect(request.signingScheme).toBe('presign')
      expect(request.sellAmountBeforeFee).toBe('1000000')
      expect(JSON.parse(request.appData).metadata.orderClass).toEqual({ orderClass: 'limit' })

      const networkFeeInBuyToken = (quotedBuyAmount * 10000n) / 990000n
      const partnerFee = ((quotedBuyAmount + networkFeeInBuyToken) * 50n) / 10000n
      expect(buyAmount).toBe(quotedBuyAmount - partnerFee)
      // The market price before fees, which the price the user sets is compared to
      expect(buyAmountBeforeFees).toBe(quotedBuyAmount + networkFeeInBuyToken)
      // 1% of the sell amount, in the sell token
      expect(networkFee).toBe(10000n)
      expect(protocolFeeBps).toBe(0)
      expect(quoteId).toBe(7)
    })

    it('quotes the native token as an ETH-flow order selling the wrapped token', async () => {
      const fetch = makeQuoteFetch()
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey })

      await api.getLimitOrderMarketQuote({
        chainId: 1,
        sellToken: ZeroAddress,
        buyToken: usdc,
        sellAmount: 10n ** 18n,
        owner: userAddress
      })

      const request = JSON.parse((fetch.mock.calls[0] as any)[1].body)
      expect(request.sellToken).toBe(weth)
      expect(request.signingScheme).toBe('eip1271')
      expect(request.onchainOrder).toBe(true)
    })

    it('rejects a quote for other tokens than requested', async () => {
      const api = new CowSwapAPI({
        fetch: makeQuoteFetch({ buyToken: usdc }) as any,
        apiKey
      })

      await expect(
        api.getLimitOrderMarketQuote({
          chainId: 1,
          sellToken: usdc,
          buyToken: weth,
          sellAmount: 1000000n,
          owner: userAddress
        })
      ).rejects.toThrow('do not match your request')
    })

    it('rejects a quote that spends a different amount', async () => {
      const api = new CowSwapAPI({
        fetch: makeQuoteFetch({ sellAmount: '1' }) as any,
        apiKey
      })

      await expect(
        api.getLimitOrderMarketQuote({
          chainId: 1,
          sellToken: usdc,
          buyToken: weth,
          sellAmount: 1000000n,
          owner: userAddress
        })
      ).rejects.toThrow('unexpected spend amount')
    })

    it('does not ask CoW Swap for a price of nothing', async () => {
      const fetch = makeQuoteFetch()
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey })

      await expect(
        api.getLimitOrderMarketQuote({
          chainId: 1,
          sellToken: usdc,
          buyToken: weth,
          sellAmount: 0n,
          owner: userAddress
        })
      ).rejects.toThrow('Enter an amount first')
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('submitLimitOrder', () => {
    it('posts a pre-sign order and accepts the matching order ID', async () => {
      const order = makeOrder()
      const orderUid = computeOrderUid({ chainId: 1, order, owner: userAddress, isEthFlow: false })
      const fetch = jest.fn(async () => makeResponse(orderUid))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey })

      await api.submitLimitOrder({ chainId: 1, order, orderUid, isEthFlow: false })

      const [url, init] = fetch.mock.calls[0] as any
      expect(url).toContain('/mainnet/api/v1/orders')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual(order)
    })

    it('treats an order CoW Swap already has as placed', async () => {
      const order = makeOrder()
      const orderUid = computeOrderUid({ chainId: 1, order, owner: userAddress, isEthFlow: false })
      const api = new CowSwapAPI({
        fetch: jest.fn(async () => makeResponse({ errorType: 'DuplicatedOrder' }, false)) as any,
        apiKey
      })

      await expect(
        api.submitLimitOrder({ chainId: 1, order, orderUid, isEthFlow: false })
      ).resolves.toBeUndefined()
    })

    it('rejects an order ID that CoW Swap answers with a different one', async () => {
      const order = makeOrder()
      const orderUid = computeOrderUid({ chainId: 1, order, owner: userAddress, isEthFlow: false })
      const api = new CowSwapAPI({
        fetch: jest.fn(async () => makeResponse(`0x${'22'.repeat(56)}`)) as any,
        apiKey
      })

      await expect(
        api.submitLimitOrder({ chainId: 1, order, orderUid, isEthFlow: false })
      ).rejects.toThrow('returned a different order')
    })

    it('never sends an order that no longer matches the ID the transaction pre-signs', async () => {
      const order = makeOrder()
      const orderUid = computeOrderUid({ chainId: 1, order, owner: userAddress, isEthFlow: false })
      const fetch = jest.fn(async () => makeResponse(orderUid))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey })

      await expect(
        api.submitLimitOrder({
          chainId: 1,
          // A lower receive amount than the one the order ID commits to
          order: { ...order, buyAmount: '1' },
          orderUid,
          isEthFlow: false
        })
      ).rejects.toThrow('details changed')
      expect(fetch).not.toHaveBeenCalled()
    })

    it('never sends app data that does not match its hash', async () => {
      const order = makeOrder()
      const tamperedOrder = {
        ...order,
        appData: buildLimitOrderAppData({ feeBps: 100 }).fullAppData
      }
      const orderUid = computeOrderUid({
        chainId: 1,
        order: tamperedOrder,
        owner: userAddress,
        isEthFlow: false
      })
      const fetch = jest.fn(async () => makeResponse(orderUid))
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey })

      await expect(
        api.submitLimitOrder({ chainId: 1, order: tamperedOrder, orderUid, isEthFlow: false })
      ).rejects.toThrow('details are invalid')
      expect(fetch).not.toHaveBeenCalled()
    })

    it('only uploads the app data of an ETH-flow order, which its transaction creates', async () => {
      const order = makeOrder({
        sellToken: weth,
        buyToken: usdc,
        partiallyFillable: false,
        signingScheme: 'eip1271'
      })
      const orderUid = computeOrderUid({ chainId: 1, order, owner: userAddress, isEthFlow: true })
      const fetch = jest.fn(async (_url: any, init: any) =>
        makeResponse({ fullAppData: JSON.parse(init.body).fullAppData })
      )
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey })

      await api.submitLimitOrder({ chainId: 1, order, orderUid, isEthFlow: true })

      expect(fetch).toHaveBeenCalledTimes(1)
      const [url, init] = fetch.mock.calls[0] as any
      expect(url).toContain(`/app_data/${order.appDataHash}`)
      expect(init.method).toBe('PUT')
    })
  })

  describe('getAccountLimitOrders', () => {
    it('returns only the Ambire limit orders of the account', async () => {
      const limitOrder = makeAccountOrder()
      const swapOrder = makeAccountOrder({
        uid: `0x${'33'.repeat(56)}`,
        fullAppData: buildAppData({ slippageBps: 50 }).fullAppData
      })
      const otherAppOrder = makeAccountOrder({
        uid: `0x${'44'.repeat(56)}`,
        fullAppData: JSON.stringify({
          appCode: 'CoW Swap',
          metadata: { orderClass: { orderClass: 'limit' } }
        })
      })
      const malformedOrder = { ...makeAccountOrder(), sellAmount: undefined }
      const fetch = jest.fn(async () =>
        makeResponse([limitOrder, swapOrder, otherAppOrder, malformedOrder])
      )
      const api = new CowSwapAPI({ fetch: fetch as any, apiKey })

      const orders = await api.getAccountLimitOrders({ chainId: 1, owner: userAddress })

      expect(orders).toEqual([limitOrder])
      expect((fetch.mock.calls[0] as any)[0]).toContain(`/account/${userAddress}/orders`)
    })

    it('rejects a response that is not a list of orders', async () => {
      const api = new CowSwapAPI({
        fetch: jest.fn(async () => makeResponse({ orders: [] })) as any,
        apiKey
      })

      await expect(api.getAccountLimitOrders({ chainId: 1, owner: userAddress })).rejects.toThrow(
        'unexpected response'
      )
    })
  })
})
