import { Interface, ZeroAddress } from 'ethers'

import { describe, expect, it, jest } from '@jest/globals'

import {
  COWSWAP_BUY_NATIVE_TOKEN_ADDRESS,
  COWSWAP_SETTLEMENT_ADDRESS,
  COWSWAP_VAULT_RELAYER_ADDRESS
} from '../../services/cowswap/constants'
import { buildLimitOrderAppData } from '../../services/cowswap/helper'
import { AccountOpStatus } from '../../libs/accountOp/types'
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
        marketBuyAmount: 875000000n,
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
    // 1% better than today's price, which is after CoW Swap's network cost (`marketBuyAmount`),
    // in the "1 ETH gets you ... USDC" view as that price is the readable one
    expect(controller.triggerBuyAmount).toBe('883750000')
    const targetBuyAmount = controller.targetBuyAmount

    await controller.placeOrder()

    const { order } = cowSwapApi.submitLimitOrder.mock.calls[0]![0]
    expect(order.sellToken).toBe(weth)
    expect(order.sellAmount).toBe(sellAmount.toString())
    expect(order.signingScheme).toBe('presign')
    expect(order.partiallyFillable).toBe(true)
    // Only the Ambire fee is taken off the price the user set, as it already counts the network
    // cost. Without a fee the order asks for the whole amount at that price
    const feeBps = controller.feeExemptionReason
      ? 0n
      : BigInt(Math.round(controller.feePercent * 100))
    expect(targetBuyAmount).toBe(((883750000n * (10000n - feeBps)) / 10000n).toString())
    expect(order.buyAmount).toBe(targetBuyAmount)

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
  // No allowance or balance yet
  const providerCall = jest.fn(async (_params: any) => `0x${'0'.repeat(64)}`)
  const cowSwapApi = {
    getLimitOrderMarketQuote: jest.fn(async (_params: any) => ({
      buyAmount: 870000000n,
      marketBuyAmount: 875000000n,
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
    providers: { providers: { '1': { call: providerCall } } },
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

  return { controller, cowSwapApi, requestSignatureInWindow, providerCall, placeOrder }
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

describe('LimitOrdersController form in a popup that closes', () => {
  /** The controller with its view events, so a test can open and close views */
  const makeControllerWithViews = () => {
    const viewHandlers: Record<string, (view: any) => void> = {}
    const ui = {
      uiEvent: {
        on: jest.fn((event: string, handler: (view: any) => void) => {
          viewHandlers[event] = handler
        })
      }
    }
    const controller = new LimitOrdersController({
      selectedAccount: {
        account: { addr: accountAddr },
        portfolio: { tokens: [] },
        balanceAffectingErrors: [],
        onUpdate: jest.fn()
      },
      networks: { networks: [{ chainId: 1n, name: 'Ethereum', nativeAssetSymbol: 'ETH' }] },
      providers: { providers: {} },
      ui,
      cowSwapApi: { getAccountLimitOrders: jest.fn(async () => []) },
      storage: makeStorage(),
      requestSignatureInWindow: jest.fn(async () => {}),
      portfolioUpdate: jest.fn(),
      onBroadcastSuccess: jest.fn(async () => {}),
      onBroadcastFailed: jest.fn()
    } as unknown as ConstructorParameters<typeof LimitOrdersController>[0])

    const openView = (view: { id: string; type: string; currentRoute: string }) =>
      viewHandlers.updateView!(view)
    const closeView = (view: { id: string; type: string }) => viewHandlers.removeView!(view)

    return { controller, openView, closeView }
  }

  it('keeps a filled form when the popup closes, and opens the popup on it again', async () => {
    const { controller, openView, closeView } = makeControllerWithViews()
    openView({ id: 'popup-1', type: 'popup', currentRoute: 'limit-order' })
    await controller.updateForm({ fromAmount: '5' })

    // e.g. the user clicked outside the popup to check a price elsewhere
    closeView({ id: 'popup-1', type: 'popup' })

    expect(controller.hasPersistedPopupForm).toBe(true)
    expect(controller.fromAmount).toBe('5')
  })

  it('clears the form when a tab with it closes', async () => {
    const { controller, openView, closeView } = makeControllerWithViews()
    openView({ id: 'tab-1', type: 'tab', currentRoute: 'limit-order' })
    await controller.updateForm({ fromAmount: '5' })

    closeView({ id: 'tab-1', type: 'tab' })

    expect(controller.hasPersistedPopupForm).toBe(false)
    expect(controller.fromAmount).toBe('')
  })

  it('does not reopen the popup on an empty form', async () => {
    const { controller, openView, closeView } = makeControllerWithViews()
    openView({ id: 'popup-1', type: 'popup', currentRoute: 'limit-order' })

    closeView({ id: 'popup-1', type: 'popup' })

    expect(controller.hasPersistedPopupForm).toBe(false)
  })

  it('clears the form when the user leaves the trade screens in the popup', async () => {
    const { controller, openView } = makeControllerWithViews()
    openView({ id: 'popup-1', type: 'popup', currentRoute: 'limit-order' })
    await controller.updateForm({ fromAmount: '5' })

    openView({ id: 'popup-1', type: 'popup', currentRoute: 'dashboard' })

    expect(controller.hasPersistedPopupForm).toBe(false)
    expect(controller.fromAmount).toBe('')
  })

  it('forgets the kept form once it is cleared, e.g. on an account switch', async () => {
    const { controller, openView, closeView } = makeControllerWithViews()
    openView({ id: 'popup-1', type: 'popup', currentRoute: 'limit-order' })
    await controller.updateForm({ fromAmount: '5' })
    closeView({ id: 'popup-1', type: 'popup' })

    controller.resetForm()

    expect(controller.hasPersistedPopupForm).toBe(false)
  })
})

describe('LimitOrdersController orders that cannot fill', () => {
  const erc20 = new Interface([
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)'
  ])
  const allowanceSelector = erc20.getFunction('allowance')!.selector
  const toWord = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`

  /** The controller with a network whose token reads return `allowance` and `balance` */
  const makeControllerWithToken = (
    orders: CowSwapAccountOrder[],
    { allowance, balance }: { allowance: bigint; balance: bigint },
    { shouldFailReads = false } = {}
  ) => {
    const call = jest.fn(async ({ data }: { data: string }) => {
      if (shouldFailReads) throw new Error('The network did not answer')
      return toWord(data.startsWith(allowanceSelector) ? allowance : balance)
    })
    const controller = new LimitOrdersController({
      selectedAccount: {
        account: { addr: accountAddr },
        portfolio: { tokens: [] },
        onUpdate: jest.fn()
      },
      networks: { networks: [{ chainId: 1n, name: 'Ethereum', nativeAssetSymbol: 'ETH' }] },
      providers: { providers: { '1': { call } } },
      ui: { uiEvent: { on: jest.fn() } },
      cowSwapApi: {
        getAccountLimitOrders: jest.fn(async ({ chainId }: { chainId: number }) =>
          chainId === 1 ? orders : []
        ),
        getToken: jest.fn(async ({ address, chainId }: { address: string; chainId: number }) => {
          const token = listedTokens[address.toLowerCase()]
          return token ? { ...token, address, chainId, name: token.symbol } : null
        }),
        isTokenSupported: jest.fn(async () => false)
      },
      storage: makeStorage(),
      requestSignatureInWindow: jest.fn(async () => {}),
      portfolioUpdate: jest.fn(),
      onBroadcastSuccess: jest.fn(async () => {}),
      onBroadcastFailed: jest.fn()
    } as unknown as ConstructorParameters<typeof LimitOrdersController>[0])

    return { controller, call }
  }

  it('shows an order as unable to fill when the permission to use the token was removed', async () => {
    const { controller } = makeControllerWithToken([makeOrder()], {
      allowance: 0n,
      balance: 10n ** 12n
    })

    await controller.updateOrders()

    expect(controller.orders[0]?.status).toBe('open')
    expect(controller.orders[0]?.fillIssue).toBe('permission')
  })

  it('shows an order as unable to fill when the account holds less than it still sells', async () => {
    const { controller } = makeControllerWithToken([makeOrder()], {
      allowance: 10n ** 12n,
      balance: 999999n
    })

    await controller.updateOrders()

    expect(controller.orders[0]?.fillIssue).toBe('balance')
  })

  it('counts only what a partly filled order still sells', async () => {
    const { controller } = makeControllerWithToken(
      [makeOrder({ executedSellAmount: '600000', executedBuyAmount: '1' })],
      { allowance: 400000n, balance: 400000n }
    )

    await controller.updateOrders()

    expect(controller.orders[0]?.status).toBe('partiallyFilled')
    expect(controller.orders[0]?.fillIssue).toBeNull()
  })

  it('does not warn about an order when the network cannot be read', async () => {
    const { controller } = makeControllerWithToken(
      [makeOrder()],
      { allowance: 0n, balance: 0n },
      { shouldFailReads: true }
    )

    await controller.updateOrders()

    expect(controller.orders[0]?.fillIssue).toBeNull()
  })

  it('does not check ETH-flow or finished orders, which need no permission', async () => {
    const { controller, call } = makeControllerWithToken(
      [
        makeOrder({
          uid: `0x${'31'.repeat(56)}`,
          sellToken: weth,
          buyToken: usdc,
          ethflowData: { userValidTo: 1900000000 }
        }),
        makeOrder({ uid: `0x${'32'.repeat(56)}`, status: 'fulfilled' })
      ],
      { allowance: 0n, balance: 0n }
    )

    await controller.updateOrders()

    expect(call).not.toHaveBeenCalled()
    expect(controller.orders.every((order) => order.fillIssue === null)).toBe(true)
  })

  it('gives the permission back for all the open orders selling the token', async () => {
    const orders = [
      makeOrder({ uid: `0x${'41'.repeat(56)}` }),
      makeOrder({ uid: `0x${'42'.repeat(56)}`, sellAmount: '500000' })
    ]
    const { controller, requestSignatureInWindow } = makeSafeController(() => orders)
    // Every read of the Safe's controller answers zero: no permission and no balance
    await controller.updateOrders()
    expect(controller.orders[0]?.fillIssue).toBe('permission')

    await controller.allowAgain(`0x${'41'.repeat(56)}`)

    const { calls } = requestSignatureInWindow.mock.calls[0]![0]
    // Without a permission to reset first, only the new one, for both orders
    expect(calls).toHaveLength(1)
    expect(calls[0].to).toBe(usdc)
    expect(calls[0].data).toBe(
      erc20.encodeFunctionData('approve', [COWSWAP_VAULT_RELAYER_ADDRESS, 1500000n])
    )
  })

  it('refuses to give a permission back for an order that does not need it', async () => {
    const { controller } = makeControllerWithToken([makeOrder()], {
      allowance: 10n ** 12n,
      balance: 10n ** 12n
    })
    const errors: unknown[] = []
    controller.onError((error) => errors.push(error))
    await controller.updateOrders()

    await controller.allowAgain(makeOrder().uid)

    expect(errors).toHaveLength(1)
  })
  describe('while the permission is given back', () => {
    const allowedUid = `0x${'51'.repeat(56)}`

    /** Signs "allow again" in the signing window and broadcasts it, and returns its calls */
    const allowAgainAndBroadcast = async () => {
      const safe = makeSafeController(() => [makeOrder({ uid: allowedUid })])
      await safe.controller.updateOrders()
      await safe.controller.allowAgain(allowedUid)
      const { calls } = safe.requestSignatureInWindow.mock.calls[0]![0]
      const broadcastCalls = withNewIds(calls)
      safe.controller.onAccountOpBroadcast({ accountAddr, chainId: 1n, calls: broadcastCalls })
      // The refresh the broadcast starts, which still reads no permission
      await safe.controller.updateOrders()

      return { ...safe, broadcastCalls }
    }

    it('does not show the order as allowed again before its transaction is sent', async () => {
      const { controller } = makeSafeController(() => [makeOrder({ uid: allowedUid })])
      await controller.updateOrders()

      // e.g. the user rejects it in the signing window
      await controller.allowAgain(allowedUid)

      expect(controller.orders[0]?.fillIssue).toBe('permission')
      expect(controller.orders[0]?.isAllowingAgain).toBe(false)
    })

    it('shows the order as being allowed again once its transaction is sent', async () => {
      const { controller } = await allowAgainAndBroadcast()

      expect(controller.orders[0]?.fillIssue).toBe('permission')
      expect(controller.orders[0]?.isAllowingAgain).toBe(true)
    })

    it('refreshes the order as soon as the transaction is confirmed', async () => {
      const { controller, providerCall, broadcastCalls } = await allowAgainAndBroadcast()
      providerCall.mockImplementation(async () => `0x${(10n ** 12n).toString(16).padStart(64, '0')}`)

      controller.onAccountOpsFinalized([
        { chainId: 1n, status: AccountOpStatus.Success, calls: broadcastCalls } as any
      ])
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
      await controller.updateOrders()

      expect(controller.orders[0]?.fillIssue).toBeNull()
      expect(controller.orders[0]?.isAllowingAgain).toBe(false)
    })

    it('shows the order as unable to fill again when the transaction fails', async () => {
      const { controller, broadcastCalls } = await allowAgainAndBroadcast()

      controller.onAccountOpsFinalized([
        { chainId: 1n, status: AccountOpStatus.Failure, calls: broadcastCalls } as any
      ])
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
      await controller.updateOrders()

      expect(controller.orders[0]?.fillIssue).toBe('permission')
      expect(controller.orders[0]?.isAllowingAgain).toBe(false)
    })

    it('keeps waiting while the transaction is not confirmed', async () => {
      const { controller, cowSwapApi, broadcastCalls } = await allowAgainAndBroadcast()
      const fetchCount = cowSwapApi.getAccountLimitOrders.mock.calls.length

      controller.onAccountOpsFinalized([
        { chainId: 1n, status: AccountOpStatus.BroadcastedButNotConfirmed, calls: broadcastCalls } as any
      ])

      expect(cowSwapApi.getAccountLimitOrders.mock.calls.length).toBe(fetchCount)
      expect(controller.orders[0]?.isAllowingAgain).toBe(true)
    })

    it('stops showing the order as being allowed again if the confirmation never comes', async () => {
      const { controller } = await allowAgainAndBroadcast()
      const now = Date.now()
      const dateNow = jest.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000)

      try {
        await controller.updateOrders()
      } finally {
        dateNow.mockRestore()
      }

      // So the user can try again
      expect(controller.orders[0]?.fillIssue).toBe('permission')
      expect(controller.orders[0]?.isAllowingAgain).toBe(false)
    })

    it('ignores confirmed transactions that are not about its permission', async () => {
      const { controller, cowSwapApi } = await allowAgainAndBroadcast()
      const fetchCount = cowSwapApi.getAccountLimitOrders.mock.calls.length

      controller.onAccountOpsFinalized([
        {
          chainId: 1n,
          status: AccountOpStatus.Success,
          calls: [
            {
              id: 'other',
              to: usdc,
              value: 0n,
              // The same permission, given to someone else
              data: erc20.encodeFunctionData('approve', [accountAddr, 10n ** 12n])
            }
          ]
        } as any
      ])

      expect(cowSwapApi.getAccountLimitOrders.mock.calls.length).toBe(fetchCount)
      expect(controller.orders[0]?.isAllowingAgain).toBe(true)
    })
  })
})
