import { Interface, ZeroAddress } from 'ethers'

import { describe, expect, it, jest } from '@jest/globals'

import {
  COWSWAP_BUY_NATIVE_TOKEN_ADDRESS,
  COWSWAP_SETTLEMENT_ADDRESS,
  COWSWAP_VAULT_RELAYER_ADDRESS
} from '../../services/cowswap/constants'
import { buildLimitOrderAppData } from '../../services/cowswap/helper'
import { CowSwapAccountOrder } from '../../services/cowswap/types'
import { LimitOrdersController } from './limitOrders'

// Placing reads the account kind only to pick a gas sponsor, which these tests don't need
jest.mock('../../libs/account/getBaseAccount', () => ({ getBaseAccount: () => ({}) }))
jest.mock('../../libs/erc7677/erc7677', () => ({ getAmbirePaymasterService: () => undefined }))

const accountAddr = '0x0000000000000000000000000000000000000001'
const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

const listedTokens: Record<string, { symbol: string; decimals: number }> = {
  [usdc.toLowerCase()]: { symbol: 'USDC', decimals: 6 },
  [weth.toLowerCase()]: { symbol: 'WETH', decimals: 18 }
}

const makeOrder = (overrides: Partial<CowSwapAccountOrder> = {}): CowSwapAccountOrder => ({
  uid: `0x${'11'.repeat(56)}`,
  status: 'open',
  sellToken: usdc,
  buyToken: weth,
  receiver: accountAddr,
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

/**
 * The controller with only what My orders reads. `getAccountOrders` answers each refresh, so a
 * test can change the orders between refreshes
 */
/** An in-memory storage, starting with `initial` */
const makeStorage = (initial: Record<string, unknown> = {}) => {
  const data: Record<string, unknown> = { ...initial }
  return {
    data,
    get: jest.fn(async (key: string, defaultValue?: unknown) => data[key] ?? defaultValue),
    set: jest.fn(async (key: string, value: unknown) => {
      data[key] = value
      return null
    })
  }
}

const makeController = (
  getAccountOrders: () => CowSwapAccountOrder[] | Promise<CowSwapAccountOrder[]>,
  storage = makeStorage()
) => {
  const portfolioUpdate = jest.fn()
  const selectedAccount = {
    account: { addr: accountAddr },
    portfolio: { tokens: [] },
    onUpdate: jest.fn()
  }
  const cowSwapApi = {
    getAccountLimitOrders: jest.fn(async ({ chainId }: { chainId: number }) =>
      chainId === 1 ? getAccountOrders() : []
    ),
    getToken: jest.fn(async ({ address, chainId }: { address: string; chainId: number }) => {
      const token = listedTokens[address.toLowerCase()]
      return token ? { ...token, address, chainId, name: token.symbol } : null
    }),
    isTokenSupported: jest.fn(async () => false)
  }

  const controller = new LimitOrdersController({
    selectedAccount,
    networks: { networks: [{ chainId: 1n, name: 'Ethereum', nativeAssetSymbol: 'ETH' }] },
    providers: { providers: {} },
    ui: { uiEvent: { on: jest.fn() } },
    cowSwapApi,
    portfolioUpdate,
    storage,
    requestSignatureInWindow: jest.fn(async () => {}),
    onBroadcastSuccess: jest.fn(async () => {}),
    onBroadcastFailed: jest.fn()
  } as unknown as ConstructorParameters<typeof LimitOrdersController>[0])

  return { controller, portfolioUpdate, selectedAccount, cowSwapApi, storage }
}

describe('LimitOrdersController My orders', () => {
  it('refreshes the portfolio on the network where an order received tokens', async () => {
    let orders = [makeOrder()]
    const { controller, portfolioUpdate } = makeController(() => orders)

    await controller.updateOrders()
    // Nothing to compare the first refresh with, so no fill is assumed
    expect(portfolioUpdate).not.toHaveBeenCalled()

    orders = [makeOrder({ executedSellAmount: '400000', executedBuyAmount: '240000000000000' })]
    await controller.updateOrders()
    expect(portfolioUpdate).toHaveBeenCalledTimes(1)
    expect(portfolioUpdate).toHaveBeenCalledWith([1n])

    // The same amounts again mean nothing new filled
    await controller.updateOrders()
    expect(portfolioUpdate).toHaveBeenCalledTimes(1)
  })

  it('does not refresh the portfolio for an order listed for the first time already filled', async () => {
    const { controller, portfolioUpdate } = makeController(() => [
      makeOrder({ status: 'fulfilled', executedBuyAmount: '600000000000000' })
    ])

    await controller.updateOrders()

    expect(portfolioUpdate).not.toHaveBeenCalled()
    expect(controller.orders[0]?.status).toBe('filled')
  })

  it('maps the statuses CoW Swap reports to the ones My orders shows', async () => {
    const { controller } = makeController(() => [
      makeOrder({ uid: `0x${'01'.repeat(56)}`, status: 'open' }),
      makeOrder({
        uid: `0x${'02'.repeat(56)}`,
        status: 'open',
        executedSellAmount: '1',
        executedBuyAmount: '1'
      }),
      makeOrder({ uid: `0x${'03'.repeat(56)}`, status: 'cancelled' }),
      makeOrder({ uid: `0x${'04'.repeat(56)}`, status: 'expired' })
    ])

    await controller.updateOrders()

    const statusByUid = Object.fromEntries(controller.orders.map((o) => [o.uid, o.status]))
    expect(statusByUid).toEqual({
      [`0x${'01'.repeat(56)}`]: 'open',
      [`0x${'02'.repeat(56)}`]: 'partiallyFilled',
      [`0x${'03'.repeat(56)}`]: 'cancelled',
      [`0x${'04'.repeat(56)}`]: 'expired'
    })
  })

  it('hides an order whose pre-sign transaction this session never sent', async () => {
    const { controller } = makeController(() => [makeOrder({ status: 'presignaturePending' })])

    await controller.updateOrders()

    expect(controller.orders).toEqual([])
  })

  it('lists an order that buys the native token as the network native token', async () => {
    const { controller } = makeController(() => [
      makeOrder({ buyToken: COWSWAP_BUY_NATIVE_TOKEN_ADDRESS })
    ])

    await controller.updateOrders()

    expect(controller.orders).toHaveLength(1)
    expect(controller.orders[0]?.buyToken).toMatchObject({
      address: ZeroAddress,
      symbol: 'ETH',
      decimals: 18
    })
  })

  it('shows an ETH-flow order CoW Swap refused as not accepted, until it is cancelled', async () => {
    const refusedOrder = {
      sellToken: weth,
      buyToken: usdc,
      ethflowData: { userValidTo: 1900000000 },
      onchainOrderData: { placementError: 'QuoteNotFound' }
    }
    let orders = [makeOrder({ ...refusedOrder, status: 'open' })]
    const { controller } = makeController(() => orders)

    await controller.updateOrders()
    expect(controller.orders[0]?.status).toBe('rejected')
    // The ETH-flow order sells the native token, not WETH
    expect(controller.orders[0]?.sellToken.symbol).toBe('ETH')

    orders = [makeOrder({ ...refusedOrder, status: 'cancelled' })]
    await controller.updateOrders()
    expect(controller.orders[0]?.status).toBe('cancelled')
  })

  it('drops the orders of an account the user switched away from during a refresh', async () => {
    let resolveOrders: (orders: CowSwapAccountOrder[]) => void = () => {}
    const pendingOrders = new Promise<CowSwapAccountOrder[]>((resolve) => {
      resolveOrders = resolve
    })
    const { controller, selectedAccount } = makeController(() => pendingOrders)

    // The refresh waits on CoW Swap while the user switches accounts
    const refresh = controller.updateOrders()
    selectedAccount.account = { addr: '0x0000000000000000000000000000000000000002' }
    resolveOrders([makeOrder()])
    await refresh

    expect(controller.orders).toEqual([])
  })
})

describe('LimitOrdersController placing an order that sells the native token', () => {
  it('sells the wrapped token and wraps the native token first, in the same batch', async () => {
    const sellAmount = 5n * 10n ** 17n
    const ethToken = {
      address: ZeroAddress,
      chainId: 1n,
      decimals: 18,
      symbol: 'ETH',
      name: 'Ether',
      amount: 10n ** 18n,
      priceIn: [],
      flags: { onGasTank: false, rewardsType: null, isFeeToken: true, canTopUpGasTank: true }
    }
    const usdcToken = { address: usdc, chainId: 1, decimals: 6, symbol: 'USDC', name: 'USD Coin' }
    const requestSignatureInWindow = jest.fn(async (_params: any) => {})
    const cowSwapApi = {
      getLimitOrderMarketQuote: jest.fn(async (_params: any) => ({
        buyAmount: 870000000n,
        buyAmountBeforeFees: 875000000n,
        networkFee: 0n,
        protocolFeeBps: 0,
        quoteId: 1
      })),
      getToTokenList: jest.fn(async () => []),
      getAccountLimitOrders: jest.fn(async () => []),
      submitLimitOrder: jest.fn(async (_params: any) => {})
    }
    const controller = new LimitOrdersController({
      selectedAccount: {
        // A Safe signs in the signing window, which receives the whole batch
        account: { addr: accountAddr, safeCreation: {} },
        portfolio: { tokens: [ethToken] },
        balanceAffectingErrors: [],
        onUpdate: jest.fn()
      },
      accounts: {
        accountStates: {},
        getOrFetchAccountOnChainState: jest.fn(async () => ({ nonce: 0n }))
      },
      networks: { networks: [{ chainId: 1n, name: 'Ethereum', nativeAssetSymbol: 'ETH' }] },
      // No allowance yet, so the batch includes the token permission
      providers: { providers: { '1': { call: jest.fn(async () => `0x${'0'.repeat(64)}`) } } },
      featureFlags: { isFeatureEnabled: () => false },
      portfolio: { getAccountPortfolioState: () => ({}) },
      ui: { uiEvent: { on: jest.fn() } },
      cowSwapApi,
      relayerUrl: '',
      storage: makeStorage(),
      requestSignatureInWindow,
      portfolioUpdate: jest.fn(),
      onBroadcastSuccess: jest.fn(async () => {}),
      onBroadcastFailed: jest.fn()
    } as unknown as ConstructorParameters<typeof LimitOrdersController>[0])

    await controller.initForm('test')
    await controller.updateForm({
      fromSelectedToken: ethToken as any,
      toSelectedToken: usdcToken,
      fromAmount: '0.5'
    })
    // Today's price is requested after a short pause for typing
    await new Promise((resolve) => {
      setTimeout(resolve, 600)
    })

    expect(cowSwapApi.getLimitOrderMarketQuote).toHaveBeenCalled()
    expect(cowSwapApi.getLimitOrderMarketQuote.mock.calls[0]![0].sellToken).toBe(weth)
    expect(controller.formStatus).toBe('READY')

    await controller.placeOrder()

    const { order } = cowSwapApi.submitLimitOrder.mock.calls[0]![0]
    expect(order.sellToken).toBe(weth)
    expect(order.sellAmount).toBe(sellAmount.toString())
    expect(order.signingScheme).toBe('presign')
    expect(order.partiallyFillable).toBe(true)

    const { calls } = requestSignatureInWindow.mock.calls[0]![0]
    const erc20Interface = new Interface(['function approve(address,uint256)'])
    expect(calls.map((call: any) => call.to)).toEqual([weth, weth, COWSWAP_SETTLEMENT_ADDRESS])
    // Wrapping first, with the amount sold
    expect(calls[0].value).toBe(sellAmount)
    expect(calls[0].data).toBe(new Interface(['function deposit() payable']).encodeFunctionData('deposit'))
    // Then the permission for the wrapped token, then the pre-sign
    expect(calls[1].data).toBe(
      erc20Interface.encodeFunctionData('approve', [COWSWAP_VAULT_RELAYER_ADDRESS, sellAmount])
    )
    expect(calls[2].value).toBe(0n)

    controller.resetForm()
  })
})

describe('LimitOrdersController orders for the dashboard', () => {
  it('does not send an account to CoW Swap if it never placed a limit order here', async () => {
    const { controller, cowSwapApi } = makeController(() => [makeOrder()])

    await controller.refreshOrdersIfNeeded()

    expect(cowSwapApi.getAccountLimitOrders).not.toHaveBeenCalled()
    expect(controller.orders).toEqual([])
  })

  it('fetches the orders of an account that placed limit orders here', async () => {
    const storage = makeStorage({ limitOrdersAccounts: [accountAddr.toLowerCase()] })
    const { controller, cowSwapApi } = makeController(() => [makeOrder()], storage)

    await controller.refreshOrdersIfNeeded()

    expect(cowSwapApi.getAccountLimitOrders).toHaveBeenCalled()
    expect(controller.orders).toHaveLength(1)
  })

  it('does not fetch again within a minute', async () => {
    const storage = makeStorage({ limitOrdersAccounts: [accountAddr.toLowerCase()] })
    const { controller, cowSwapApi } = makeController(() => [makeOrder()], storage)

    await controller.refreshOrdersIfNeeded()
    const callsAfterFirstRefresh = cowSwapApi.getAccountLimitOrders.mock.calls.length
    await controller.refreshOrdersIfNeeded()

    expect(cowSwapApi.getAccountLimitOrders.mock.calls.length).toBe(callsAfterFirstRefresh)
  })

  it('remembers an account whose orders My orders found, e.g. placed on another device', async () => {
    const storage = makeStorage()
    const { controller } = makeController(() => [makeOrder()], storage)

    await controller.updateOrders()
    // The write runs after the refresh, in order with other writes
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(storage.data.limitOrdersAccounts).toEqual([accountAddr.toLowerCase()])
  })
})

/**
 * A Safe account's controller, which signs in the signing window. `getAccountOrders` answers each
 * refresh of My orders
 */
const makeSafeController = (
  getAccountOrders: () => CowSwapAccountOrder[] = () => []
) => {
  const ethToken = {
    address: ZeroAddress,
    chainId: 1n,
    decimals: 18,
    symbol: 'ETH',
    name: 'Ether',
    amount: 10n ** 18n,
    priceIn: [],
    flags: { onGasTank: false, rewardsType: null, isFeeToken: true, canTopUpGasTank: true }
  }
  const requestSignatureInWindow = jest.fn(async (_params: any) => {})
  const cowSwapApi = {
    getLimitOrderMarketQuote: jest.fn(async (_params: any) => ({
      buyAmount: 870000000n,
      buyAmountBeforeFees: 875000000n,
      networkFee: 0n,
      protocolFeeBps: 0,
      quoteId: 1
    })),
    getToTokenList: jest.fn(async () => []),
    getAccountLimitOrders: jest.fn(async ({ chainId }: { chainId: number }) =>
      chainId === 1 ? getAccountOrders() : []
    ),
    getToken: jest.fn(async ({ address, chainId }: { address: string; chainId: number }) => {
      const token = listedTokens[address.toLowerCase()]
      return token ? { ...token, address, chainId, name: token.symbol } : null
    }),
    isTokenSupported: jest.fn(async () => false),
    submitLimitOrder: jest.fn(async (_params: any) => {})
  }
  const controller = new LimitOrdersController({
    selectedAccount: {
      account: { addr: accountAddr, safeCreation: {} },
      portfolio: { tokens: [ethToken] },
      balanceAffectingErrors: [],
      onUpdate: jest.fn()
    },
    accounts: {
      accountStates: {},
      getOrFetchAccountOnChainState: jest.fn(async () => ({ nonce: 0n }))
    },
    networks: { networks: [{ chainId: 1n, name: 'Ethereum', nativeAssetSymbol: 'ETH' }] },
    // No allowance yet, so the batch includes the token permission
    providers: { providers: { '1': { call: jest.fn(async () => `0x${'0'.repeat(64)}`) } } },
    featureFlags: { isFeatureEnabled: () => false },
    portfolio: { getAccountPortfolioState: () => ({}) },
    ui: { uiEvent: { on: jest.fn() } },
    cowSwapApi,
    relayerUrl: '',
    storage: makeStorage(),
    requestSignatureInWindow,
    portfolioUpdate: jest.fn(),
    onBroadcastSuccess: jest.fn(async () => {}),
    onBroadcastFailed: jest.fn()
  } as unknown as ConstructorParameters<typeof LimitOrdersController>[0])

  /** Places an order selling 0.5 ETH for USDC and returns its uid and the calls sent to sign */
  const placeOrder = async () => {
    await controller.initForm('test')
    await controller.updateForm({
      fromSelectedToken: ethToken as any,
      toSelectedToken: { address: usdc, chainId: 1, decimals: 6, symbol: 'USDC', name: 'USD Coin' },
      fromAmount: '0.5'
    })
    // Today's price is requested after a short pause for typing
    await new Promise((resolve) => {
      setTimeout(resolve, 600)
    })
    await controller.placeOrder()

    const { orderUid } = cowSwapApi.submitLimitOrder.mock.calls[0]![0]
    const { calls } = requestSignatureInWindow.mock.calls[0]![0]
    controller.resetForm()

    return { orderUid: orderUid as string, calls }
  }

  return { controller, cowSwapApi, requestSignatureInWindow, placeOrder }
}

/** The calls as the signing window broadcasts them, with ids of its own */
const withNewIds = (calls: any[]) => calls.map((call, i) => ({ ...call, id: `window-${i}` }))

describe('LimitOrdersController orders signed in the signing window', () => {
  it('does not show an order as placing while its transaction is waiting in the signing window', async () => {
    let orders: CowSwapAccountOrder[] = []
    const { controller, placeOrder } = makeSafeController(() => orders)

    const { orderUid } = await placeOrder()
    // CoW Swap lists the order as soon as it's submitted, before it's signed
    orders = [makeOrder({ uid: orderUid, sellToken: weth, buyToken: usdc, status: 'presignaturePending' })]
    await controller.updateOrders()

    expect(controller.orders).toEqual([])
  })

  it('never shows an order whose transaction the user rejected in the signing window', async () => {
    let orders: CowSwapAccountOrder[] = []
    const { controller, placeOrder } = makeSafeController(() => orders)

    const { orderUid } = await placeOrder()
    orders = [makeOrder({ uid: orderUid, sellToken: weth, buyToken: usdc, status: 'presignaturePending' })]
    // Rejecting broadcasts nothing, while other transactions of the account still go out
    controller.onAccountOpBroadcast({
      accountAddr,
      chainId: 1n,
      calls: [{ id: 'other', to: weth, value: 0n, data: '0x' }]
    })
    await controller.updateOrders()

    expect(controller.orders).toEqual([])
  })

  it('shows the order as placing once its transaction is broadcast', async () => {
    let orders: CowSwapAccountOrder[] = []
    const { controller, cowSwapApi, placeOrder } = makeSafeController(() => orders)

    const { orderUid, calls } = await placeOrder()
    orders = [makeOrder({ uid: orderUid, sellToken: weth, buyToken: usdc, status: 'presignaturePending' })]
    const fetchesBeforeBroadcast = cowSwapApi.getAccountLimitOrders.mock.calls.length
    controller.onAccountOpBroadcast({ accountAddr, chainId: 1n, calls: withNewIds(calls) })
    // The broadcast refreshes My orders, as the new order isn't listed yet
    await controller.updateOrders()

    expect(cowSwapApi.getAccountLimitOrders.mock.calls.length).toBeGreaterThan(fetchesBeforeBroadcast)
    expect(controller.orders.map((order) => [order.uid, order.status])).toEqual([[orderUid, 'placing']])
  })

  it('does not mark an order broadcast on another network', async () => {
    let orders: CowSwapAccountOrder[] = []
    const { controller, placeOrder } = makeSafeController(() => orders)

    const { orderUid, calls } = await placeOrder()
    orders = [makeOrder({ uid: orderUid, sellToken: weth, buyToken: usdc, status: 'presignaturePending' })]
    controller.onAccountOpBroadcast({ accountAddr, chainId: 10n, calls: withNewIds(calls) })
    await controller.updateOrders()

    expect(controller.orders).toEqual([])
  })

  it('shows an order as cancelling only once its cancel transaction is broadcast', async () => {
    const orderUid = `0x${'21'.repeat(56)}`
    const { controller, requestSignatureInWindow } = makeSafeController(() => [
      makeOrder({ uid: orderUid })
    ])
    await controller.updateOrders()

    await controller.cancelOrder(orderUid)
    await controller.updateOrders()
    // Still waiting for the Safe's owners, who may reject it
    expect(controller.orders[0]?.status).toBe('open')

    const { calls } = requestSignatureInWindow.mock.calls[0]![0]
    expect(calls[0].data).toBe(
      new Interface(['function invalidateOrder(bytes)']).encodeFunctionData('invalidateOrder', [
        orderUid
      ])
    )
    controller.onAccountOpBroadcast({ accountAddr, chainId: 1n, calls: withNewIds(calls) })

    expect(controller.orders[0]?.status).toBe('cancelling')
  })
})
