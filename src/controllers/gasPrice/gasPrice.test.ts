import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { BaseAccount } from '../../libs/account/BaseAccount'
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
  supportsBundlerEstimation = false
}: {
  isErc4337Enabled: boolean
  supportsBundlerEstimation?: boolean
}) => {
  const featureFlags = {
    initialLoadPromise: Promise.resolve(),
    isFeatureEnabled: jest.fn((flag) => (flag === 'erc4337' ? isErc4337Enabled : true))
  } as unknown as IFeatureFlagsController
  const baseAccount = {
    supportsBundlerEstimation: jest.fn(() => supportsBundlerEstimation)
  } as unknown as BaseAccount

  return new GasPriceController(
    network,
    provider,
    baseAccount,
    () => ({
      estimation: {} as EstimationController,
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
})
