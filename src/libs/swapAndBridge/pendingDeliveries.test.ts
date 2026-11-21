import { describe, expect, test } from '@jest/globals'

import { SwapAndBridgeActiveRoute, SwapAndBridgeRoute } from '../../interfaces/swapAndBridge'
import {
  addPendingDeliveryAmounts,
  getPendingDeliveries,
  getPendingDeliveriesSignature,
  getPendingDeliveryKey,
  PendingDeliveries
} from './pendingDeliveries'

const ACCOUNT = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const OTHER_ACCOUNT = '0x0000000000000000000000000000000000000abc'
const USDC_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const WETH_ETHEREUM = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const NATIVE = '0x0000000000000000000000000000000000000000'
const NATIVE_EEEE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

type RouteOverrides = Partial<
  Pick<
    SwapAndBridgeRoute,
    'providerId' | 'fromChainId' | 'toChainId' | 'fromAmount' | 'toAmount' | 'isIntent'
  > & {
    networkFeeInToToken: string
    // Only the amounts of the steps are relevant for these tests
    steps: { fromAmount: string; toAmount: string }[]
  }
>

const makeActiveRoute = ({
  routeStatus = 'in-progress',
  sender = ACCOUNT,
  fromAssetAddress = USDC_ETHEREUM,
  toAssetAddress = USDC_BASE,
  withoutRoute = false,
  route = {}
}: {
  routeStatus?: SwapAndBridgeActiveRoute['routeStatus']
  sender?: string
  fromAssetAddress?: string
  toAssetAddress?: string
  withoutRoute?: boolean
  route?: RouteOverrides
} = {}): SwapAndBridgeActiveRoute => {
  // Only the fields the pending deliveries read are relevant for these tests
  const fullRoute = {
    providerId: 'lifi',
    fromChainId: 1,
    toChainId: 8453,
    fromAmount: '1000000',
    toAmount: '990000',
    routeStatus,
    currentUserTxIndex: 0,
    transactionData: null,
    userAddress: sender,
    ...route
  } as unknown as SwapAndBridgeActiveRoute['route']

  return {
    serviceProviderId: fullRoute!.providerId,
    activeRouteId: `${fromAssetAddress}-${toAssetAddress}-${routeStatus}`,
    userTxIndex: 0,
    userTxHash: '0x1',
    identifiedBy: null,
    fromAssetAddress,
    toAssetAddress,
    steps: [],
    sender,
    routeStatus,
    route: withoutRoute ? undefined : fullRoute
  }
}

describe('getPendingDeliveryKey', () => {
  test('ignores the address case', () => {
    expect(getPendingDeliveryKey(1, USDC_ETHEREUM)).toBe(
      getPendingDeliveryKey(1n, USDC_ETHEREUM.toLowerCase())
    )
  })

  test('treats both native token addresses as the same token', () => {
    expect(getPendingDeliveryKey(1n, NATIVE_EEEE)).toBe(getPendingDeliveryKey(1n, NATIVE))
  })

  test('separates the same address on different networks', () => {
    expect(getPendingDeliveryKey(1n, NATIVE)).not.toBe(getPendingDeliveryKey(10n, NATIVE))
  })
})

/** The pending amounts only, keyed like `getPendingDeliveries`, to keep the amount tests short */
const getPendingAmounts = (activeRoutes: SwapAndBridgeActiveRoute[], accountAddr: string) =>
  Object.fromEntries(
    Object.entries(getPendingDeliveries(activeRoutes, accountAddr)).map(
      ([tokenKey, { amount }]) => [tokenKey, amount]
    )
  )

describe('getPendingDeliveries', () => {
  test('a bridge has only the received tokens pending, on the destination network', () => {
    const pendingDeliveries = getPendingAmounts([makeActiveRoute()], ACCOUNT)

    expect(pendingDeliveries).toEqual({
      [getPendingDeliveryKey(8453, USDC_BASE)]: 990000n
    })
  })

  test('a CoW Swap ERC-20 sell has both the sent and the received tokens pending', () => {
    const pendingDeliveries = getPendingAmounts(
      [
        makeActiveRoute({
          fromAssetAddress: USDC_ETHEREUM,
          toAssetAddress: WETH_ETHEREUM,
          route: { providerId: 'cowswap', fromChainId: 1, toChainId: 1, toAmount: '500' }
        })
      ],
      ACCOUNT
    )

    expect(pendingDeliveries).toEqual({
      [getPendingDeliveryKey(1, USDC_ETHEREUM)]: -1000000n,
      [getPendingDeliveryKey(1, WETH_ETHEREUM)]: 500n
    })
  })

  test('a CoW Swap native sell has only the received tokens pending', () => {
    const pendingDeliveries = getPendingAmounts(
      [
        makeActiveRoute({
          fromAssetAddress: NATIVE,
          toAssetAddress: USDC_ETHEREUM,
          route: { providerId: 'cowswap', fromChainId: 1, toChainId: 1, toAmount: '500' }
        })
      ],
      ACCOUNT
    )

    expect(pendingDeliveries).toEqual({ [getPendingDeliveryKey(1, USDC_ETHEREUM)]: 500n })
  })

  test('a CoW Swap native sell with the 0xEeee native address has only the received tokens pending', () => {
    const pendingDeliveries = getPendingAmounts(
      [
        makeActiveRoute({
          fromAssetAddress: NATIVE_EEEE,
          toAssetAddress: USDC_ETHEREUM,
          route: { providerId: 'cowswap', fromChainId: 1, toChainId: 1, toAmount: '500' }
        })
      ],
      ACCOUNT
    )

    expect(pendingDeliveries).toEqual({ [getPendingDeliveryKey(1, USDC_ETHEREUM)]: 500n })
  })

  test('the CoW Swap network fee is not deducted, to match the amount the route card shows', () => {
    const pendingDeliveries = getPendingAmounts(
      [
        makeActiveRoute({
          fromAssetAddress: NATIVE,
          toAssetAddress: USDC_ETHEREUM,
          route: {
            providerId: 'cowswap',
            fromChainId: 1,
            toChainId: 1,
            toAmount: '500',
            networkFeeInToToken: '20'
          }
        })
      ],
      ACCOUNT
    )

    expect(pendingDeliveries).toEqual({ [getPendingDeliveryKey(1, USDC_ETHEREUM)]: 500n })
  })

  test('the amounts of the first and last steps are used, as the route card shows them', () => {
    const pendingDeliveries = getPendingAmounts(
      [
        makeActiveRoute({
          fromAssetAddress: USDC_ETHEREUM,
          toAssetAddress: WETH_ETHEREUM,
          route: {
            providerId: 'cowswap',
            fromChainId: 1,
            toChainId: 1,
            fromAmount: '1',
            toAmount: '1',
            steps: [
              { fromAmount: '1000', toAmount: '900' },
              { fromAmount: '900', toAmount: '800' }
            ]
          }
        })
      ],
      ACCOUNT
    )

    expect(pendingDeliveries).toEqual({
      [getPendingDeliveryKey(1, USDC_ETHEREUM)]: -1000n,
      [getPendingDeliveryKey(1, WETH_ETHEREUM)]: 800n
    })
  })

  test('a same-network intent swap of another provider has only the received tokens pending', () => {
    const pendingDeliveries = getPendingAmounts(
      [
        makeActiveRoute({
          fromAssetAddress: USDC_ETHEREUM,
          toAssetAddress: WETH_ETHEREUM,
          route: { providerId: 'lifi', fromChainId: 1, toChainId: 1, isIntent: true }
        })
      ],
      ACCOUNT
    )

    expect(pendingDeliveries).toEqual({ [getPendingDeliveryKey(1, WETH_ETHEREUM)]: 990000n })
  })

  test('regular swaps are ignored, as they finish with the transaction', () => {
    const pendingDeliveries = getPendingAmounts(
      [
        makeActiveRoute({
          fromAssetAddress: USDC_ETHEREUM,
          toAssetAddress: WETH_ETHEREUM,
          route: { providerId: 'lifi', fromChainId: 1, toChainId: 1 }
        })
      ],
      ACCOUNT
    )

    expect(pendingDeliveries).toEqual({})
  })

  test.each([
    'waiting-approval-to-resolve',
    'ready',
    'completed',
    'failed',
    'refunded'
  ] as SwapAndBridgeActiveRoute['routeStatus'][])(
    'routes that are %s are ignored',
    (routeStatus) => {
      expect(getPendingAmounts([makeActiveRoute({ routeStatus })], ACCOUNT)).toEqual({})
    }
  )

  test('routes of other accounts are ignored', () => {
    expect(getPendingAmounts([makeActiveRoute({ sender: OTHER_ACCOUNT })], ACCOUNT)).toEqual({})
  })

  test('the account address is matched case-insensitively', () => {
    expect(
      getPendingAmounts([makeActiveRoute({ sender: ACCOUNT.toLowerCase() })], ACCOUNT)
    ).toEqual({ [getPendingDeliveryKey(8453, USDC_BASE)]: 990000n })
  })

  test('routes whose transaction is not known to be sent yet are ignored', () => {
    expect(getPendingAmounts([{ ...makeActiveRoute(), userTxHash: null }], ACCOUNT)).toEqual({})
  })

  test.each([undefined, '', '1.5', '-100', '1e18', 'abc'])(
    'a route with the received amount %p is ignored instead of throwing',
    (toAmount) => {
      const activeRoute = makeActiveRoute({ route: { toAmount: toAmount as string } })

      expect(getPendingAmounts([activeRoute], ACCOUNT)).toEqual({})
    }
  )

  test('a CoW Swap order with a malformed sent amount is ignored as a whole', () => {
    const activeRoute = makeActiveRoute({
      fromAssetAddress: USDC_ETHEREUM,
      toAssetAddress: WETH_ETHEREUM,
      route: { providerId: 'cowswap', fromChainId: 1, toChainId: 1, fromAmount: 'abc' }
    })

    expect(getPendingAmounts([activeRoute], ACCOUNT)).toEqual({})
  })

  test('a malformed route does not stop the other routes from counting', () => {
    const malformedRoute = {
      ...makeActiveRoute({ route: { toAmount: 'abc' } }),
      activeRouteId: 'malformed'
    }

    expect(getPendingAmounts([malformedRoute, makeActiveRoute()], ACCOUNT)).toEqual({
      [getPendingDeliveryKey(8453, USDC_BASE)]: 990000n
    })
  })

  test('old routes without route data are ignored', () => {
    expect(getPendingAmounts([makeActiveRoute({ withoutRoute: true })], ACCOUNT)).toEqual({})
  })

  test('amounts of several routes for the same token are summed', () => {
    const firstBridge = makeActiveRoute()
    const secondBridge = {
      ...makeActiveRoute({ route: { toAmount: '10' } }),
      activeRouteId: 'second'
    }

    expect(getPendingAmounts([firstBridge, secondBridge], ACCOUNT)).toEqual({
      [getPendingDeliveryKey(8453, USDC_BASE)]: 990010n
    })
  })

  test('a CoW Swap order and a bridge of the same token are netted', () => {
    const cowSwapSellingUsdc = makeActiveRoute({
      fromAssetAddress: USDC_ETHEREUM,
      toAssetAddress: WETH_ETHEREUM,
      route: { providerId: 'cowswap', fromChainId: 1, toChainId: 1, fromAmount: '300' }
    })
    const bridgeToEthereumUsdc = makeActiveRoute({
      fromAssetAddress: USDC_BASE,
      toAssetAddress: USDC_ETHEREUM,
      route: { fromChainId: 8453, toChainId: 1, toAmount: '1000' }
    })

    expect(
      getPendingAmounts([cowSwapSellingUsdc, bridgeToEthereumUsdc], ACCOUNT)[
        getPendingDeliveryKey(1, USDC_ETHEREUM)
      ]
    ).toBe(700n)
  })

  test('no routes means nothing is pending', () => {
    expect(getPendingAmounts([], ACCOUNT)).toEqual({})
  })

  test('each token lists the routes that move it', () => {
    const cowSwapSellingUsdc = makeActiveRoute({
      fromAssetAddress: USDC_ETHEREUM,
      toAssetAddress: WETH_ETHEREUM,
      route: { providerId: 'cowswap', fromChainId: 1, toChainId: 1 }
    })
    const bridgeToEthereumUsdc = makeActiveRoute({
      fromAssetAddress: USDC_BASE,
      toAssetAddress: USDC_ETHEREUM,
      route: { fromChainId: 8453, toChainId: 1 }
    })

    const pendingDeliveries = getPendingDeliveries(
      [cowSwapSellingUsdc, bridgeToEthereumUsdc],
      ACCOUNT
    )

    expect(pendingDeliveries[getPendingDeliveryKey(1, USDC_ETHEREUM)]?.activeRouteIds).toEqual([
      cowSwapSellingUsdc.activeRouteId,
      bridgeToEthereumUsdc.activeRouteId
    ])
    expect(pendingDeliveries[getPendingDeliveryKey(1, WETH_ETHEREUM)]?.activeRouteIds).toEqual([
      cowSwapSellingUsdc.activeRouteId
    ])
  })
})

describe('getPendingDeliveriesSignature', () => {
  const usdcKey = getPendingDeliveryKey(8453, USDC_BASE)
  const wethKey = getPendingDeliveryKey(1, WETH_ETHEREUM)

  test('is the same for the same amounts, whatever their order or routes', () => {
    expect(
      getPendingDeliveriesSignature({
        [usdcKey]: { amount: 1n, activeRouteIds: ['a'] },
        [wethKey]: { amount: 2n, activeRouteIds: ['b'] }
      })
    ).toBe(
      getPendingDeliveriesSignature({
        [wethKey]: { amount: 2n, activeRouteIds: ['c'] },
        [usdcKey]: { amount: 1n, activeRouteIds: ['d'] }
      })
    )
  })

  test('changes when an amount changes', () => {
    expect(
      getPendingDeliveriesSignature({ [usdcKey]: { amount: 1n, activeRouteIds: ['a'] } })
    ).not.toBe(getPendingDeliveriesSignature({ [usdcKey]: { amount: 2n, activeRouteIds: ['a'] } }))
  })

  test('is empty when nothing is on its way', () => {
    expect(getPendingDeliveriesSignature({})).toBe('')
  })
})

describe('addPendingDeliveryAmounts', () => {
  const flags = { onGasTank: false, rewardsType: null, canTopUpGasTank: false, isFeeToken: false }
  const usdcOnBase = { chainId: 8453n, address: USDC_BASE, flags }
  const usdcOnEthereum = { chainId: 1n, address: USDC_ETHEREUM, flags }
  const pendingDeliveries: PendingDeliveries = {
    [getPendingDeliveryKey(8453, USDC_BASE)]: { amount: 100n, activeRouteIds: ['bridge'] }
  }

  test('sets the amount on the tokens on their way only', () => {
    const [withDelivery, withoutDelivery] = addPendingDeliveryAmounts(
      [usdcOnBase, usdcOnEthereum],
      pendingDeliveries
    )

    expect(withDelivery).toEqual({ ...usdcOnBase, pendingDeliveryAmount: 100n })
    expect(withoutDelivery).toBe(usdcOnEthereum)
  })

  test('returns the same tokens when nothing is on its way', () => {
    const tokens = [usdcOnBase]

    expect(addPendingDeliveryAmounts(tokens, {})).toBe(tokens)
  })

  test('does not change the tokens it is given', () => {
    addPendingDeliveryAmounts([usdcOnBase], pendingDeliveries)

    expect(usdcOnBase).not.toHaveProperty('pendingDeliveryAmount')
  })

  test('skips the Gas Tank and rewards copies of the token', () => {
    const onGasTank = { ...usdcOnBase, flags: { ...flags, onGasTank: true } }
    const rewards = { ...usdcOnBase, flags: { ...flags, rewardsType: 'wallet-rewards' as const } }

    const [gasTankResult, rewardsResult] = addPendingDeliveryAmounts(
      [onGasTank, rewards],
      pendingDeliveries
    )

    expect(gasTankResult).toBe(onGasTank)
    expect(rewardsResult).toBe(rewards)
  })

  test('skips deliveries that cancel each other out', () => {
    const [token] = addPendingDeliveryAmounts([usdcOnBase], {
      [getPendingDeliveryKey(8453, USDC_BASE)]: { amount: 0n, activeRouteIds: ['a', 'b'] }
    })

    expect(token).toBe(usdcOnBase)
  })
})
