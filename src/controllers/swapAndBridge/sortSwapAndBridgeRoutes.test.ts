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
})
