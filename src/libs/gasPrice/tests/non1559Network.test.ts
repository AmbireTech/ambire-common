import { ethers } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { suppressConsoleBeforeEach } from '../../../../test/helpers/console'
import { networks } from '../../../consts/networks'
import { GasPriceRecommendation, getGasPriceRecommendations, MIN_GAS_PRICE } from '../gasPrice'
import MockProvider from './MockProvider'

const network = networks.find((n) => n.chainId === 1n)!
const polygon = networks.find((n) => n.chainId === 137n)!
const legacyNetwork = { ...network, feeOptions: { is1559: false } }

const getByName = (recommendations: GasPriceRecommendation[], name: string) =>
  recommendations.find((recommendation) => recommendation.name === name)!

describe('non-1559 Network gas price tests', () => {
  // Mock providers throw errors we can ignore
  suppressConsoleBeforeEach()

  test('should use viem legacy gas price estimation for speed recommendations', async () => {
    const provider = MockProvider.init({
      baseFeePerGas: null,
      ethGasPrice: ethers.parseUnits('2', 'gwei')
    })

    const gasPriceData = await getGasPriceRecommendations(provider, legacyNetwork)
    const gasPrice = gasPriceData.gasPrice as GasPriceRecommendation[]

    expect(getByName(gasPrice, 'slow').gasPrice).toBe(ethers.parseUnits('2.4', 'gwei'))
    expect(getByName(gasPrice, 'medium').gasPrice).toBe(ethers.parseUnits('2.52', 'gwei'))
    expect(getByName(gasPrice, 'fast').gasPrice).toBe(ethers.parseUnits('2.64', 'gwei'))
    expect(getByName(gasPrice, 'ape').gasPrice).toBe(ethers.parseUnits('2.76', 'gwei'))
    provider.destroy()
  })

  test('should not return a gas price below the minimum', async () => {
    const provider = MockProvider.init({
      baseFeePerGas: null,
      ethGasPrice: 100n
    })

    const gasPriceData = await getGasPriceRecommendations(provider, legacyNetwork)
    const gasPrice = gasPriceData.gasPrice as GasPriceRecommendation[]

    expect(getByName(gasPrice, 'slow').gasPrice).toBe(MIN_GAS_PRICE)
    expect(getByName(gasPrice, 'medium').gasPrice).toBe(1050000000n)
    expect(getByName(gasPrice, 'fast').gasPrice).toBe(1100000000n)
    expect(getByName(gasPrice, 'ape').gasPrice).toBe(1150000000n)
    provider.destroy()
  })

  test('should apply the network fee increase before speed multipliers', async () => {
    const provider = MockProvider.init({
      baseFeePerGas: null,
      ethGasPrice: ethers.parseUnits('2', 'gwei')
    })

    const gasPriceData = await getGasPriceRecommendations(provider, polygon)
    const gasPrice = gasPriceData.gasPrice as GasPriceRecommendation[]

    expect(getByName(gasPrice, 'slow').gasPrice).toBe(ethers.parseUnits('2.64', 'gwei'))
    expect(getByName(gasPrice, 'medium').gasPrice).toBe(ethers.parseUnits('2.772', 'gwei'))
    expect(getByName(gasPrice, 'fast').gasPrice).toBe(ethers.parseUnits('2.904', 'gwei'))
    expect(getByName(gasPrice, 'ape').gasPrice).toBe(ethers.parseUnits('3.036', 'gwei'))
    provider.destroy()
  })
})
