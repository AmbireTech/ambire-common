import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { BaseAccount, GasPriceFetchStrategy } from '../../libs/account/BaseAccount'
import { gasPriceToBundlerFormat, getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { Bundler } from '../../services/bundlers/bundler'
import { getAvailableBunlders } from '../../services/bundlers/getBundler'
import { GasSpeeds } from '../../services/bundlers/types'
import { EstimationController } from '../estimation/estimation'
import { GasPriceController } from './gasPrice'

jest.mock('../../libs/gasPrice/gasPrice', () => ({
  gasPriceToBundlerFormat: jest.fn(),
  getGasPriceRecommendations: jest.fn()
}))
jest.mock('../../services/bundlers/getBundler', () => ({
  getAvailableBunlders: jest.fn()
}))

const gasSpeeds: GasSpeeds = {
  slow: { maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1' },
  medium: { maxFeePerGas: '0x2', maxPriorityFeePerGas: '0x2' },
  fast: { maxFeePerGas: '0x3', maxPriorityFeePerGas: '0x3' },
  ape: { maxFeePerGas: '0x4', maxPriorityFeePerGas: '0x4' }
}

// differs from gasSpeeds so tests can tell which source the prices came from
const bundlerGasSpeeds: GasSpeeds = {
  ...gasSpeeds,
  fast: { maxFeePerGas: '0x9', maxPriorityFeePerGas: '0x9' }
}

const network = { name: 'Ethereum' } as Network
const provider = {} as RPCProvider

const createController = ({
  isErc4337Enabled,
  supportsBundlerEstimation = false,
  gasPriceFetchStrategy = 'bundlerWithRpcFallback',
  estimation = {} as EstimationController
}: {
  isErc4337Enabled: boolean
  supportsBundlerEstimation?: boolean
  gasPriceFetchStrategy?: GasPriceFetchStrategy
  estimation?: EstimationController
}) => {
  const featureFlags = {
    initialLoadPromise: Promise.resolve(),
    isFeatureEnabled: jest.fn((flag) => (flag === 'erc4337' ? isErc4337Enabled : true))
  } as unknown as IFeatureFlagsController
  const baseAccount = {
    supportsBundlerEstimation: jest.fn(() => supportsBundlerEstimation),
    getGasPriceFetchStrategy: jest.fn(() => gasPriceFetchStrategy)
  } as unknown as BaseAccount

  return new GasPriceController(
    network,
    provider,
    baseAccount,
    () => ({
      estimation,
      readyToSign: true,
      stopRefetching: false
    }),
    featureFlags
  )
}

describe('GasPriceController', () => {
  beforeEach(() => {
    jest.mocked(getAvailableBunlders).mockReset()
    jest.mocked(getGasPriceRecommendations).mockReset()
    jest.mocked(gasPriceToBundlerFormat).mockReset()
    jest.mocked(getGasPriceRecommendations).mockResolvedValue({
      gasPrice: [{ name: 'slow', gasPrice: 1n }]
    })
    jest.mocked(gasPriceToBundlerFormat).mockReturnValue(gasSpeeds)
  })

  test('uses bundler gas prices when ERC-4337 is enabled', async () => {
    const fetchGasPrices = jest.fn(async () => gasSpeeds)
    jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
    const controller = createController({ isErc4337Enabled: true })

    await controller.fetch()

    expect(fetchGasPrices).toHaveBeenCalledWith(network)
    expect(getGasPriceRecommendations).not.toHaveBeenCalled()
    expect(controller.gasPrices).toEqual(gasSpeeds)
  })

  test('does not call a bundler when ERC-4337 is disabled and uses provider gas prices', async () => {
    const fetchGasPrices = jest.fn(async () => gasSpeeds)
    jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
    const controller = createController({ isErc4337Enabled: false })

    await controller.fetch()

    expect(getAvailableBunlders).not.toHaveBeenCalled()
    expect(fetchGasPrices).not.toHaveBeenCalled()
    expect(getGasPriceRecommendations).toHaveBeenCalledWith(
      provider,
      network,
      -1,
      expect.any(Function)
    )
    expect(controller.gasPrices).toEqual(gasSpeeds)
  })

  test('uses provider gas prices when bundler estimation supplies its own gas prices', async () => {
    const fetchGasPrices = jest.fn(async () => gasSpeeds)
    jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
    const controller = createController({
      isErc4337Enabled: true,
      supportsBundlerEstimation: true
    })

    await controller.fetch()

    expect(fetchGasPrices).not.toHaveBeenCalled()
    expect(getGasPriceRecommendations).toHaveBeenCalled()
    expect(controller.gasPrices).toEqual(gasSpeeds)
  })

  test('uses only provider gas prices when the account relies on the RPC', async () => {
    const fetchGasPrices = jest.fn(async () => gasSpeeds)
    jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
    const controller = createController({
      isErc4337Enabled: true,
      gasPriceFetchStrategy: 'rpc'
    })

    await controller.fetch()

    expect(fetchGasPrices).not.toHaveBeenCalled()
    expect(getGasPriceRecommendations).toHaveBeenCalled()
    expect(controller.gasPrices).toEqual(gasSpeeds)
    expect(controller.rpcGasPrices).toBeUndefined()
  })

  describe('RPC with a bundler fallback', () => {
    test('uses the RPC gas prices for both fields and skips the bundler when the RPC succeeds', async () => {
      const fetchGasPrices = jest.fn(async () => bundlerGasSpeeds)
      jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
      const controller = createController({
        isErc4337Enabled: true,
        supportsBundlerEstimation: true,
        gasPriceFetchStrategy: 'rpcWithBundlerFallback'
      })

      await controller.fetch()

      expect(fetchGasPrices).not.toHaveBeenCalled()
      expect(getGasPriceRecommendations).toHaveBeenCalled()
      expect(controller.rpcGasPrices).toEqual(gasSpeeds)
      // mirrors the RPC gas prices so signAccountOp has gas prices while
      // there's no bundler estimation to take the bundler ones from
      expect(controller.gasPrices).toEqual(gasSpeeds)
    })

    test('still fetches the RPC gas prices when the bundler estimation supplies the bundler ones', async () => {
      const fetchGasPrices = jest.fn(async () => bundlerGasSpeeds)
      jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
      const controller = createController({
        isErc4337Enabled: true,
        supportsBundlerEstimation: true,
        gasPriceFetchStrategy: 'rpcWithBundlerFallback'
      })
      controller.areGasPricesUsedFromBundlerEstimation = true

      await controller.fetch()

      expect(fetchGasPrices).not.toHaveBeenCalled()
      expect(getGasPriceRecommendations).toHaveBeenCalled()
      expect(controller.rpcGasPrices).toEqual(gasSpeeds)
    })

    test('fetches nothing when the bundler estimation supplies the gas prices for other strategies', async () => {
      const fetchGasPrices = jest.fn(async () => bundlerGasSpeeds)
      jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
      const controller = createController({
        isErc4337Enabled: true,
        supportsBundlerEstimation: true,
        gasPriceFetchStrategy: 'bundlerWithRpcFallback'
      })
      controller.areGasPricesUsedFromBundlerEstimation = true

      await controller.fetch()

      expect(fetchGasPrices).not.toHaveBeenCalled()
      expect(getGasPriceRecommendations).not.toHaveBeenCalled()
      expect(controller.gasPrices).toBeUndefined()
      expect(controller.updatedAt).toBeUndefined()
    })

    test('stores the bundler gas prices in both fields when the RPC fails', async () => {
      jest.mocked(getGasPriceRecommendations).mockRejectedValue(new Error('rpc down'))
      const fetchGasPrices = jest.fn(async () => bundlerGasSpeeds)
      jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
      const controller = createController({
        isErc4337Enabled: true,
        gasPriceFetchStrategy: 'rpcWithBundlerFallback'
      })

      await controller.fetch()

      expect(fetchGasPrices).toHaveBeenCalledWith(network)
      expect(controller.rpcGasPrices).toEqual(bundlerGasSpeeds)
      expect(controller.gasPrices).toEqual(bundlerGasSpeeds)
    })

    test('replaces the bundler fallback with the RPC gas prices once the RPC recovers', async () => {
      jest.mocked(getGasPriceRecommendations).mockRejectedValueOnce(new Error('rpc down'))
      const fetchGasPrices = jest.fn(async () => bundlerGasSpeeds)
      jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
      const controller = createController({
        isErc4337Enabled: true,
        gasPriceFetchStrategy: 'rpcWithBundlerFallback'
      })

      await controller.fetch()
      expect(controller.rpcGasPrices).toEqual(bundlerGasSpeeds)

      await controller.fetch()

      expect(fetchGasPrices).toHaveBeenCalledTimes(1)
      expect(controller.rpcGasPrices).toEqual(gasSpeeds)
      expect(controller.gasPrices).toEqual(gasSpeeds)
    })
  })

  describe('RPC failure with a bundler fallback', () => {
    const estimation = { isRetryingFailure: () => false } as unknown as EstimationController

    test('does not emit an error when the bundler fallback succeeds', async () => {
      jest.mocked(getGasPriceRecommendations).mockRejectedValue(new Error('rpc down'))
      const fetchGasPrices = jest.fn(async () => gasSpeeds)
      jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
      const controller = createController({
        isErc4337Enabled: true,
        gasPriceFetchStrategy: 'rpcWithBundlerFallback',
        estimation
      })
      const onError = jest.fn()
      controller.onError(onError)

      await controller.fetch('major')

      expect(fetchGasPrices).toHaveBeenCalledWith(network)
      expect(controller.gasPrices).toEqual(gasSpeeds)
      expect(controller.rpcGasPrices).toEqual(gasSpeeds)
      expect(onError).not.toHaveBeenCalled()
    })

    test('emits the RPC error once when the bundler fallback fails as well', async () => {
      jest.mocked(getGasPriceRecommendations).mockRejectedValue(new Error('rpc down'))
      const fetchGasPrices = jest.fn(async () => {
        throw new Error('bundler down')
      })
      jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
      const controller = createController({
        isErc4337Enabled: true,
        gasPriceFetchStrategy: 'rpcWithBundlerFallback',
        estimation
      })
      const onError = jest.fn()
      controller.onError(onError)

      await controller.fetch('major')

      expect(controller.gasPrices).toBeUndefined()
      expect(controller.rpcGasPrices).toBeUndefined()
      expect(onError).toHaveBeenCalledTimes(1)
      expect(controller.emittedErrors[0]?.level).toBe('major')
      expect(controller.emittedErrors[0]?.error.message).toContain('rpc down')
    })

    test('emits the RPC error when there are no bundlers to fall back to', async () => {
      jest.mocked(getGasPriceRecommendations).mockRejectedValue(new Error('rpc down'))
      jest.mocked(getAvailableBunlders).mockReturnValue([])
      const controller = createController({
        isErc4337Enabled: true,
        gasPriceFetchStrategy: 'rpcWithBundlerFallback',
        estimation
      })
      const onError = jest.fn()
      controller.onError(onError)

      await controller.fetch('major')

      expect(getAvailableBunlders).toHaveBeenCalledWith(network)
      expect(controller.rpcGasPrices).toBeUndefined()
      expect(onError).toHaveBeenCalledTimes(1)
    })

    test('does not emit an error when gas prices were already fetched once', async () => {
      jest.mocked(getAvailableBunlders).mockReturnValue([])
      const controller = createController({
        isErc4337Enabled: true,
        gasPriceFetchStrategy: 'rpcWithBundlerFallback',
        estimation
      })
      await controller.fetch('major')
      expect(controller.rpcGasPrices).toEqual(gasSpeeds)

      jest.mocked(getGasPriceRecommendations).mockRejectedValue(new Error('rpc down'))
      const onError = jest.fn()
      controller.onError(onError)

      await controller.fetch('major')

      expect(controller.rpcGasPrices).toEqual(gasSpeeds)
      expect(onError).not.toHaveBeenCalled()
    })
  })

  describe('RPC gas price timeout', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    test('gives up on a hanging RPC after 10s and emits an error', async () => {
      jest.mocked(getGasPriceRecommendations).mockReturnValue(new Promise(() => {}))
      const controller = createController({
        isErc4337Enabled: false,
        estimation: { isRetryingFailure: () => false } as unknown as EstimationController
      })
      const onError = jest.fn()
      controller.onError(onError)
      let hasFetchCompleted = false

      const fetchPromise = controller.fetch('major').then(() => {
        hasFetchCompleted = true
      })

      await jest.advanceTimersByTimeAsync(9999)
      expect(hasFetchCompleted).toBe(false)

      await jest.advanceTimersByTimeAsync(1)
      await fetchPromise

      expect(controller.gasPrices).toBeUndefined()
      expect(controller.updatedAt).toBeDefined()
      expect(onError).toHaveBeenCalledTimes(1)
      expect(controller.emittedErrors[0]?.level).toBe('major')
      expect(controller.emittedErrors[0]?.error.message).toContain('request too slow')
    })

    test('keeps the previous gas prices when a later RPC fetch hangs', async () => {
      const controller = createController({
        isErc4337Enabled: false,
        estimation: { isRetryingFailure: () => false } as unknown as EstimationController
      })
      await controller.fetch()
      expect(controller.gasPrices).toEqual(gasSpeeds)

      jest.mocked(getGasPriceRecommendations).mockReturnValue(new Promise(() => {}))
      const onError = jest.fn()
      controller.onError(onError)

      const fetchPromise = controller.fetch('major')
      await jest.advanceTimersByTimeAsync(10000)
      await fetchPromise

      expect(controller.gasPrices).toEqual(gasSpeeds)
      // the gas prices were fetched once successfully, so no error is emitted
      expect(onError).not.toHaveBeenCalled()
    })

    test('waits for a pending RPC request instead of starting a new one', async () => {
      let resolveRequest!: (value: Awaited<ReturnType<typeof getGasPriceRecommendations>>) => void
      jest.mocked(getGasPriceRecommendations).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRequest = resolve
        })
      )
      const controller = createController({
        isErc4337Enabled: false,
        estimation: { isRetryingFailure: () => true } as unknown as EstimationController
      })

      // two fetches time out while the same request hangs
      for (let i = 0; i < 2; i++) {
        const fetchPromise = controller.fetch()
        await jest.advanceTimersByTimeAsync(10000)
        await fetchPromise
      }
      expect(getGasPriceRecommendations).toHaveBeenCalledTimes(1)
      expect(controller.gasPrices).toBeUndefined()

      // the hanging request answers while a later fetch waits for it
      const fetchPromise = controller.fetch()
      await jest.advanceTimersByTimeAsync(1000)
      resolveRequest({ gasPrice: [{ name: 'slow', gasPrice: 1n }] })
      await fetchPromise

      expect(getGasPriceRecommendations).toHaveBeenCalledTimes(1)
      expect(controller.gasPrices).toEqual(gasSpeeds)
      expect(jest.getTimerCount()).toBe(0)

      // once it has settled, the next fetch starts a new request
      await controller.fetch()
      expect(getGasPriceRecommendations).toHaveBeenCalledTimes(2)
    })

    test('starts a new RPC request once the pending one fails', async () => {
      let rejectRequest!: (error: Error) => void
      jest.mocked(getGasPriceRecommendations).mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectRequest = reject
        })
      )
      const controller = createController({
        isErc4337Enabled: false,
        estimation: { isRetryingFailure: () => true } as unknown as EstimationController
      })

      const timedOutFetch = controller.fetch()
      await jest.advanceTimersByTimeAsync(10000)
      await timedOutFetch

      // fails after the fetch has stopped waiting for it
      rejectRequest(new Error('rpc down'))
      await jest.advanceTimersByTimeAsync(0)

      await controller.fetch()

      expect(getGasPriceRecommendations).toHaveBeenCalledTimes(2)
      expect(controller.gasPrices).toEqual(gasSpeeds)
    })

    test('shares the pending RPC request with the bundler fallback strategy', async () => {
      jest.mocked(getGasPriceRecommendations).mockReturnValueOnce(new Promise(() => {}))
      const fetchGasPrices = jest.fn(async () => gasSpeeds)
      jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
      const controller = createController({
        isErc4337Enabled: true,
        gasPriceFetchStrategy: 'rpcWithBundlerFallback',
        estimation: { isRetryingFailure: () => true } as unknown as EstimationController
      })

      for (let i = 0; i < 3; i++) {
        const fetchPromise = controller.fetch()
        await jest.advanceTimersByTimeAsync(5000)
        await fetchPromise
      }

      expect(getGasPriceRecommendations).toHaveBeenCalledTimes(1)
      // the bundler fallback keeps the fees available meanwhile
      expect(fetchGasPrices).toHaveBeenCalledTimes(3)
      expect(controller.rpcGasPrices).toEqual(gasSpeeds)
    })

    test('clears the timeout when the RPC responds in time', async () => {
      const controller = createController({ isErc4337Enabled: false })

      await controller.fetch()

      expect(controller.gasPrices).toEqual(gasSpeeds)
      expect(jest.getTimerCount()).toBe(0)
    })

    test('falls back to the bundler after a 5s RPC timeout without emitting an error', async () => {
      jest.mocked(getGasPriceRecommendations).mockReturnValue(new Promise(() => {}))
      const fetchGasPrices = jest.fn(async () => bundlerGasSpeeds)
      jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
      const controller = createController({
        isErc4337Enabled: true,
        gasPriceFetchStrategy: 'rpcWithBundlerFallback',
        estimation: { isRetryingFailure: () => false } as unknown as EstimationController
      })
      const onError = jest.fn()
      controller.onError(onError)

      const fetchPromise = controller.fetch('major')
      await jest.advanceTimersByTimeAsync(4999)
      expect(fetchGasPrices).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(1)
      await fetchPromise

      expect(fetchGasPrices).toHaveBeenCalledWith(network)
      expect(controller.rpcGasPrices).toEqual(bundlerGasSpeeds)
      expect(controller.gasPrices).toEqual(bundlerGasSpeeds)
      expect(onError).not.toHaveBeenCalled()
      expect(jest.getTimerCount()).toBe(0)
    })
  })
})
