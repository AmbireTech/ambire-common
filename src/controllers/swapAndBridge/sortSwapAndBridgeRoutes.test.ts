import { describe, expect, it } from '@jest/globals'

import { SwapAndBridgeRoute } from '../../interfaces/swapAndBridge'
import { sortSwapAndBridgeRoutes } from './swapAndBridge'

const getRoute = (route: Partial<SwapAndBridgeRoute>): SwapAndBridgeRoute =>
  ({
    fromChainId: 1,
    toChainId: 1,
    toAmount: '0',
    outputValueInUsd: 0,
    serviceTime: 0,
    ...route
  }) as SwapAndBridgeRoute

describe('sortSwapAndBridgeRoutes', () => {
  it('sorts routes by output value after gas when the values are available', () => {
    const routes = [
      getRoute({
        routeId: 'higher-output-before-gas',
        toAmount: '100',
        outputValueInUsd: 100,
        outputValueAfterGasInUsd: 90
      }),
      getRoute({
        routeId: 'higher-output-after-gas',
        toAmount: '99',
        outputValueInUsd: 99,
        outputValueAfterGasInUsd: 98
      })
    ]

    expect(routes.sort(sortSwapAndBridgeRoutes)[0]!.routeId).toBe('higher-output-after-gas')
  })

  it('uses the shared output token price when sorting by output value after gas', () => {
    const routes = [
      getRoute({
        routeId: 'inflated-provider-usd-value',
        toAmount: '100000000',
        outputValueInUsd: 110,
        outputValueAfterGasInUsd: 109,
        toToken: { decimals: 6 } as SwapAndBridgeRoute['toToken']
      }),
      getRoute({
        routeId: 'higher-output-amount',
        toAmount: '105000000',
        outputValueInUsd: 100,
        outputValueAfterGasInUsd: 98,
        toToken: { decimals: 6 } as SwapAndBridgeRoute['toToken']
      })
    ]

    expect(routes.sort((a, b) => sortSwapAndBridgeRoutes(a, b, 1))[0]!.routeId).toBe(
      'higher-output-amount'
    )
    expect(routes[0]!.outputValueInUsd).toBe(100)
  })

  it('falls back to raw output amounts when a net output value is missing', () => {
    const routes = [
      getRoute({
        routeId: 'higher-raw-output',
        toAmount: '100',
        outputValueInUsd: 100
      }),
      getRoute({
        routeId: 'lower-raw-output',
        toAmount: '99',
        outputValueInUsd: 99,
        outputValueAfterGasInUsd: 98
      })
    ]

    expect(routes.sort(sortSwapAndBridgeRoutes)[0]!.routeId).toBe('higher-raw-output')
  })

  describe('CoW Swap on small swaps', () => {
    const getRoutes = () => [
      getRoute({
        routeId: 'cowswap-best-output',
        providerId: 'cowswap',
        toAmount: '100',
        outputValueInUsd: 100,
        outputValueAfterGasInUsd: 99
      }),
      getRoute({
        routeId: 'lifi-worse-output',
        providerId: 'lifi',
        toAmount: '90',
        outputValueInUsd: 90,
        outputValueAfterGasInUsd: 89
      })
    ]
    const getSortedIds = (swapInputValueInUsd?: number) =>
      getRoutes()
        .sort((a, b) => sortSwapAndBridgeRoutes(a, b, null, swapInputValueInUsd))
        .map(({ routeId }) => routeId)

    it('puts CoW Swap last when the swap is worth less than $100', () => {
      expect(getSortedIds(99.99)).toEqual(['lifi-worse-output', 'cowswap-best-output'])
      expect(getSortedIds(1)).toEqual(['lifi-worse-output', 'cowswap-best-output'])
    })

    it('keeps the regular order when the swap is worth $100 or more', () => {
      expect(getSortedIds(100)).toEqual(['cowswap-best-output', 'lifi-worse-output'])
      expect(getSortedIds(5000)).toEqual(['cowswap-best-output', 'lifi-worse-output'])
    })

    it('keeps the regular order when the swap value is unknown', () => {
      expect(getSortedIds(undefined)).toEqual(['cowswap-best-output', 'lifi-worse-output'])
      expect(getSortedIds(0)).toEqual(['cowswap-best-output', 'lifi-worse-output'])
    })

    it('puts CoW Swap last even when it is the only route without a service fee', () => {
      const routes = [
        ...getRoutes(),
        getRoute({
          routeId: 'socket-with-service-fee',
          providerId: 'socket',
          toAmount: '95',
          outputValueInUsd: 95,
          serviceFee: { amountUSD: '1' } as SwapAndBridgeRoute['serviceFee']
        })
      ]

      expect(
        routes.sort((a, b) => sortSwapAndBridgeRoutes(a, b, null, 50)).map(({ routeId }) => routeId)
      ).toEqual(['lifi-worse-output', 'socket-with-service-fee', 'cowswap-best-output'])
    })

    it('sorts CoW Swap routes among themselves by output on small swaps', () => {
      const routes = [
        getRoute({ routeId: 'cowswap-lower', providerId: 'cowswap', toAmount: '80' }),
        getRoute({ routeId: 'cowswap-higher', providerId: 'cowswap', toAmount: '85' })
      ]

      expect(
        routes.sort((a, b) => sortSwapAndBridgeRoutes(a, b, null, 50)).map(({ routeId }) => routeId)
      ).toEqual(['cowswap-higher', 'cowswap-lower'])
    })
  })
})
