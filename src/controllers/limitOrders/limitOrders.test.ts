import { ZeroAddress } from 'ethers'

import { describe, expect, it, jest } from '@jest/globals'

import { COWSWAP_BUY_NATIVE_TOKEN_ADDRESS } from '../../services/cowswap/constants'
import { buildLimitOrderAppData } from '../../services/cowswap/helper'
import { CowSwapAccountOrder } from '../../services/cowswap/types'
import { LimitOrdersController } from './limitOrders'

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
const makeController = (
  getAccountOrders: () => CowSwapAccountOrder[] | Promise<CowSwapAccountOrder[]>
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
    requestSignatureInWindow: jest.fn(async () => {}),
    onBroadcastSuccess: jest.fn(async () => {}),
    onBroadcastFailed: jest.fn()
  } as unknown as ConstructorParameters<typeof LimitOrdersController>[0])

  return { controller, portfolioUpdate, selectedAccount }
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
