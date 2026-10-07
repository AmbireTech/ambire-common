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

  test('returns both collections when the account uses the RPC and the bundler', async () => {
    const bundlerGasSpeeds: GasSpeeds = {
      ...gasSpeeds,
      fast: { maxFeePerGas: '0x9', maxPriorityFeePerGas: '0x9' }
    }
    const fetchGasPrices = jest.fn(async () => bundlerGasSpeeds)
    jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
    const controller = createController({
      isErc4337Enabled: true,
      supportsBundlerEstimation: true,
      gasPriceFetchStrategy: 'rpcWithBundlerFallback'
    })

    await controller.fetch()

    expect(fetchGasPrices).toHaveBeenCalledWith(network)
    expect(getGasPriceRecommendations).toHaveBeenCalled()
    expect(controller.gasPrices).toEqual(bundlerGasSpeeds)
    expect(controller.rpcGasPrices).toEqual(gasSpeeds)
  })

  test('fetches only provider gas prices when the bundler estimation supplies the bundler ones', async () => {
    const fetchGasPrices = jest.fn(async () => gasSpeeds)
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
    expect(controller.gasPrices).toBeUndefined()
    expect(controller.rpcGasPrices).toEqual(gasSpeeds)
  })

  test('falls back to provider gas prices when the bundler fails for both collections', async () => {
    const fetchGasPrices = jest.fn(async () => {
      throw new Error('bundler down')
    })
    jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
    const controller = createController({
      isErc4337Enabled: true,
      gasPriceFetchStrategy: 'rpcWithBundlerFallback'
    })

    await controller.fetch()

    expect(controller.gasPrices).toEqual(gasSpeeds)
    expect(controller.rpcGasPrices).toEqual(gasSpeeds)
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

    test('clears the timeout when the RPC responds in time', async () => {
      const controller = createController({ isErc4337Enabled: false })

      await controller.fetch()

      expect(controller.gasPrices).toEqual(gasSpeeds)
      expect(jest.getTimerCount()).toBe(0)
    })

    test('times out the RPC collection independently of the bundler one', async () => {
      jest.mocked(getGasPriceRecommendations).mockReturnValue(new Promise(() => {}))
      const fetchGasPrices = jest.fn(async () => gasSpeeds)
      jest.mocked(getAvailableBunlders).mockReturnValue([{ fetchGasPrices } as unknown as Bundler])
      const controller = createController({
        isErc4337Enabled: true,
        gasPriceFetchStrategy: 'rpcWithBundlerFallback',
        estimation: { isRetryingFailure: () => true } as unknown as EstimationController
      })

      const fetchPromise = controller.fetch()
      await jest.advanceTimersByTimeAsync(10000)
      await fetchPromise

      expect(controller.gasPrices).toEqual(gasSpeeds)
      expect(controller.rpcGasPrices).toBeUndefined()
      expect(jest.getTimerCount()).toBe(0)
    })
  })
})
