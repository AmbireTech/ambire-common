import { Interface, ZeroAddress } from 'ethers'

import { describe, expect, it, jest } from '@jest/globals'

import { SwapAndBridgeRoute } from '../../interfaces/swapAndBridge'
import { CowSwapAPI } from './api'
import { COWSWAP_SETTLEMENT_ADDRESS, COWSWAP_VAULT_RELAYER_ADDRESS } from './constants'

const settlementInterface = new Interface(['function setPreSignature(bytes orderUid, bool signed)'])

const userAddress = '0x0000000000000000000000000000000000000001'
const tokenIn = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const tokenOut = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

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
  ...overrides
})

const makeQuoteFetch = () =>
  jest.fn(async (_url: any, init: any) => {
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
        appDataHash: request.appDataHash,
        feeAmount: '10000',
        gasAmount: '150000',
        gasPrice: '1000000000',
        sellTokenPrice: '1',
        kind: 'sell',
        partiallyFillable: false,
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20',
        signingScheme: 'presign'
      },
      from: request.from,
      expiration: new Date(Date.now() + 60000).toISOString(),
      id: 7,
      verified: true,
      protocolFeeBps: '0'
    })
  })

const makeRouteFixture = async () => {
  const api = new CowSwapAPI({ fetch: makeQuoteFetch() as any })
  return (await api.quote(makeQuoteParams())).routes[0]!
}

describe('CowSwapAPI', () => {
  it('supports only same-network CoW Swap routes', async () => {
    const api = new CowSwapAPI({ fetch: jest.fn() as any })

    expect(api.areChainsSupported({ fromChainId: 1, toChainId: 1 })).toBe(true)
    expect(api.areChainsSupported({ fromChainId: 1, toChainId: 8453 })).toBe(false)
    expect(api.areChainsSupported({ fromChainId: 10, toChainId: 10 })).toBe(false)
    await expect(api.getSupportedChains()).resolves.toContainEqual({ chainId: 42161 })
    await expect(api.getToTokenList({ fromChainId: 1, toChainId: 1 })).resolves.toEqual([])
  })

  it('requests a PreSign quote, includes the Ambire fee and returns an intent route', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any })

    const result = await api.quote(makeQuoteParams())
    const [, init] = fetch.mock.calls[0]!
    const request = JSON.parse((init as any).body)
    const appData = JSON.parse(request.appData)
    const route = result.routes[0]!

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
    const quotedBuyAmount = 500000000000000n
    const buyAmountBeforeFees = quotedBuyAmount + (quotedBuyAmount * 10000n) / 990000n
    const expectedPartnerFee = (buyAmountBeforeFees * 50n) / 10000n
    expect(route.toAmount).toBe((quotedBuyAmount - expectedPartnerFee).toString())
    expect(BigInt(route.steps[0]!.minAmountOut)).toBeLessThan(BigInt(route.toAmount))
  })

  it('builds one batchable approval plus on-chain PreSign request without posting early', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any })
    const quote = await api.quote(makeQuoteParams())
    const route = quote.routes[0]!

    const transaction = await api.startRoute(route)
    const [orderUid, signed] = settlementInterface.decodeFunctionData(
      'setPreSignature',
      transaction.txData
    )

    expect(fetch).toHaveBeenCalledTimes(1)
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

  it('uses the existing no-fee policy for wrap and unwrap operations', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any })

    const result = await api.quote(makeQuoteParams({ isWrapOrUnwrap: true }))
    const [, init] = fetch.mock.calls[0]!
    const request = JSON.parse((init as any).body)

    expect(JSON.parse(request.appData).metadata.partnerFee).toBeUndefined()
    expect(result.routes[0]!.withConvenienceFee).toBe(false)
    expect(result.routes[0]!.toAmount).toBe('500000000000000')
  })

  it('rejects native-token sells because they require a different on-chain flow', async () => {
    const fetch = jest.fn()
    const api = new CowSwapAPI({ fetch: fetch as any })

    await expect(api.quote(makeQuoteParams({ fromTokenAddress: ZeroAddress }))).rejects.toThrow(
      'cannot sell the network native token'
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects quote details that do not match the requested AppData', async () => {
    const fetch = jest.fn(async (_url: any, init: any) => {
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
          partiallyFillable: false
        },
        expiration: new Date(Date.now() + 60000).toISOString(),
        id: 7,
        verified: true
      })
    })
    const api = new CowSwapAPI({ fetch: fetch as any })

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
    const api = new CowSwapAPI({ fetch })

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
    const api = new CowSwapAPI({ fetch })

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
    const api = new CowSwapAPI({ fetch })

    await expect(
      api.getRouteStatus({
        txHash: '0x1',
        fromChainId: 1,
        toChainId: 1,
        routeId: 'order-uid',
        rawRoute: { order: {} } as any
      })
    ).resolves.toEqual({ status: 'completed', txnId: settlementTxHash })
  })

  it('reports expired orders as failed intents', async () => {
    const fetch = jest.fn(async () => makeResponse({ status: 'expired' }))
    const api = new CowSwapAPI({ fetch: fetch as any })

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
    const api = new CowSwapAPI({ fetch })

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

  it('rejects a tampered route before creating transaction calldata', async () => {
    const fetch = makeQuoteFetch()
    const api = new CowSwapAPI({ fetch: fetch as any })
    const quote = await api.quote(makeQuoteParams())
    const route = { ...quote.routes[0]!, routeId: `0x${'00'.repeat(56)}` } as SwapAndBridgeRoute

    await expect(api.startRoute(route)).rejects.toThrow('order details changed')
  })
})
