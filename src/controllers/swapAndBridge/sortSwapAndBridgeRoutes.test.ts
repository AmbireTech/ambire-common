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
