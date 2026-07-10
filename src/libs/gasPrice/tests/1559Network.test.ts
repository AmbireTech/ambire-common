import { ethers } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { suppressConsoleBeforeEach } from '../../../../test/helpers/console'
import { networks } from '../../../consts/networks'
import { Gas1559Recommendation, getGasPriceRecommendations } from '../gasPrice'
import MockProvider from './MockProvider'

const network = networks.find((net) => net.chainId === 1n)!
const baseNetwork = networks.find((net) => net.chainId === 8453n)!

const getByName = (recommendations: Gas1559Recommendation[], name: string) =>
  recommendations.find((recommendation) => recommendation.name === name)!

describe('1559 Network gas price tests', () => {
  // Mock providers throw errors we can ignore
  suppressConsoleBeforeEach()

  test('should use fee history next block base fee and reward percentiles for speed recommendations', async () => {
    const provider = MockProvider.init({
      ethMaxPriorityFeePerGas: 100n,
      feeHistory: {
        baseFeePerGas: [
          ethers.parseUnits('1', 'gwei'),
          ethers.parseUnits('1.05', 'gwei'),
          ethers.parseUnits('1.1', 'gwei'),
          ethers.parseUnits('1.15', 'gwei'),
          ethers.parseUnits('1.18', 'gwei'),
          ethers.parseUnits('1.2', 'gwei')
        ],
        reward: Array.from({ length: 5 }, () => [
          ethers.parseUnits('1', 'gwei'),
          ethers.parseUnits('2', 'gwei'),
          ethers.parseUnits('3', 'gwei'),
          ethers.parseUnits('5', 'gwei')
        ])
      }
    })

    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice as Gas1559Recommendation[]

    expect(getByName(gasPrice, 'slow')).toEqual({
      name: 'slow',
      baseFeePerGas: ethers.parseUnits('1.2', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei')
    })
    expect(getByName(gasPrice, 'medium')).toEqual({
      name: 'medium',
      baseFeePerGas: ethers.parseUnits('1.26', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei')
    })
    expect(getByName(gasPrice, 'fast')).toEqual({
      name: 'fast',
      baseFeePerGas: ethers.parseUnits('1.32', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('3', 'gwei')
    })
    expect(getByName(gasPrice, 'ape')).toEqual({
      name: 'ape',
      baseFeePerGas: ethers.parseUnits('1.38', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('5', 'gwei')
    })
    provider.destroy()
  })

  test('should fallback to viem fee estimation when fee history is unavailable', async () => {
    const provider = MockProvider.init({
      baseFeePerGas: ethers.parseUnits('1', 'gwei'),
      ethMaxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
      feeHistoryError: new Error('eth_feeHistory unsupported')
    })

    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice as Gas1559Recommendation[]

    expect(getByName(gasPrice, 'slow')).toEqual({
      name: 'slow',
      baseFeePerGas: ethers.parseUnits('1.2', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei')
    })
    expect(getByName(gasPrice, 'medium')).toEqual({
      name: 'medium',
      baseFeePerGas: ethers.parseUnits('1.26', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1.125', 'gwei')
    })
    expect(getByName(gasPrice, 'fast')).toEqual({
      name: 'fast',
      baseFeePerGas: ethers.parseUnits('1.32', 'gwei'),
      maxPriorityFeePerGas: 1265625000n
    })
    expect(getByName(gasPrice, 'ape')).toEqual({
      name: 'ape',
      baseFeePerGas: ethers.parseUnits('1.38', 'gwei'),
      maxPriorityFeePerGas: 1898437500n
    })
    provider.destroy()
  })

  test('should not return a base fee below the network minimum', async () => {
    const provider = MockProvider.init({
      baseFeePerGas: ethers.parseUnits('2', 'gwei'),
      feeHistory: {
        baseFeePerGas: [
          ethers.parseUnits('2', 'gwei'),
          ethers.parseUnits('1.8', 'gwei'),
          ethers.parseUnits('1.6', 'gwei'),
          ethers.parseUnits('1.4', 'gwei'),
          ethers.parseUnits('1.2', 'gwei'),
          ethers.parseUnits('1', 'gwei')
        ],
        reward: Array.from({ length: 5 }, () => [100000n, 200000n, 300000n, 500000n])
      }
    })

    const gasPriceData = await getGasPriceRecommendations(provider, baseNetwork)
    const gasPrice = gasPriceData.gasPrice as Gas1559Recommendation[]

    expect(getByName(gasPrice, 'slow').baseFeePerGas).toBe(ethers.parseUnits('2', 'gwei'))
    expect(getByName(gasPrice, 'medium').baseFeePerGas).toBe(ethers.parseUnits('2.1', 'gwei'))
    expect(getByName(gasPrice, 'fast').baseFeePerGas).toBe(ethers.parseUnits('2.2', 'gwei'))
    expect(getByName(gasPrice, 'ape').baseFeePerGas).toBe(ethers.parseUnits('2.3', 'gwei'))
    provider.destroy()
  })
})
