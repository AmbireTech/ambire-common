import { jest } from '@jest/globals'

import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { BaseAccount } from '../../libs/account/BaseAccount'
import { gasPriceToBundlerFormat, getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { getAvailableBunlders } from '../../services/bundlers/getBundler'
import { GasPriceController } from './gasPrice'

jest.mock('../../services/bundlers/getBundler', () => ({
  getAvailableBunlders: jest.fn()
}))

jest.mock('../../libs/gasPrice/gasPrice', () => ({
  getGasPriceRecommendations: jest.fn(),
  gasPriceToBundlerFormat: jest.fn()
}))

const getAvailableBunldersMock = getAvailableBunlders as jest.Mock
const getGasPriceRecommendationsMock = getGasPriceRecommendations as jest.Mock
const gasPriceToBundlerFormatMock = gasPriceToBundlerFormat as jest.Mock

const network = { chainId: 1n, name: 'Ethereum' } as Network
const provider = {} as RPCProvider
const baseAccount = {
  supportsBundlerEstimation: () => false
} as BaseAccount

const getSignAccountOpState = () =>
  ({
    estimation: null,
    readyToSign: false,
    stopRefetching: false
  }) as any

describe('GasPriceController', () => {
  beforeEach(() => {
    getAvailableBunldersMock.mockReset()
    getGasPriceRecommendationsMock.mockReset()
    gasPriceToBundlerFormatMock.mockReset()
    gasPriceToBundlerFormatMock.mockReturnValue({})
    getGasPriceRecommendationsMock.mockResolvedValue({ gasPrice: {} } as never)
  })

  test('does not call bundlers when ERC-4337 is disabled', async () => {
    const fetchGasPrices = jest.fn()
    getAvailableBunldersMock.mockReturnValue([{ fetchGasPrices }])

    const controller = new GasPriceController(
      network,
      provider,
      baseAccount,
      getSignAccountOpState,
      () => false
    )

    await controller.fetch()

    expect(fetchGasPrices).not.toHaveBeenCalled()
    expect(getGasPriceRecommendationsMock).toHaveBeenCalled()
  })

  test('calls bundlers when ERC-4337 is enabled and the account needs bundler gas prices', async () => {
    const gasPrices = {
      slow: { maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1' }
    }
    const fetchGasPrices = jest.fn().mockResolvedValue(gasPrices as never)
    getAvailableBunldersMock.mockReturnValue([{ fetchGasPrices }])

    const controller = new GasPriceController(
      network,
      provider,
      baseAccount,
      getSignAccountOpState,
      () => true
    )

    await controller.fetch()

    expect(fetchGasPrices).toHaveBeenCalledWith(network)
    expect(getGasPriceRecommendationsMock).not.toHaveBeenCalled()
    expect(controller.gasPrices).toBe(gasPrices)
  })
})
