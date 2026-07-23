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
      baseFeePerGas: ethers.parseUnits('1.212', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1.25', 'gwei')
    })
    expect(getByName(gasPrice, 'fast')).toEqual({
      name: 'fast',
      baseFeePerGas: ethers.parseUnits('1.224', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1.5', 'gwei')
    })
    expect(getByName(gasPrice, 'ape')).toEqual({
      name: 'ape',
      baseFeePerGas: ethers.parseUnits('1.236', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei')
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
      baseFeePerGas: ethers.parseUnits('1.212', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1.125', 'gwei')
    })
    expect(getByName(gasPrice, 'fast')).toEqual({
      name: 'fast',
      baseFeePerGas: ethers.parseUnits('1.224', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1.25', 'gwei')
    })
    expect(getByName(gasPrice, 'ape')).toEqual({
      name: 'ape',
      baseFeePerGas: ethers.parseUnits('1.236', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1.5', 'gwei')
    })
    provider.destroy()
  })

  test('should use fee history base fee even when below the network minimum', async () => {
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

    expect(getByName(gasPrice, 'slow').baseFeePerGas).toBe(ethers.parseUnits('1', 'gwei'))
    expect(getByName(gasPrice, 'medium').baseFeePerGas).toBe(ethers.parseUnits('1.01', 'gwei'))
    expect(getByName(gasPrice, 'fast').baseFeePerGas).toBe(ethers.parseUnits('1.02', 'gwei'))
    expect(getByName(gasPrice, 'ape').baseFeePerGas).toBe(ethers.parseUnits('1.03', 'gwei'))
    provider.destroy()
  })

  test('should use median priority fees so one expensive block does not distort recommendations', async () => {
    const regularRewards = [
      ethers.parseUnits('1', 'gwei'),
      ethers.parseUnits('1.2', 'gwei'),
      ethers.parseUnits('1.4', 'gwei'),
      ethers.parseUnits('1.8', 'gwei')
    ]
    const provider = MockProvider.init({
      ethMaxPriorityFeePerGas: 100n,
      feeHistory: {
        reward: [
          regularRewards,
          regularRewards,
          [
            ethers.parseUnits('10', 'gwei'),
            ethers.parseUnits('20', 'gwei'),
            ethers.parseUnits('30', 'gwei'),
            ethers.parseUnits('50', 'gwei')
          ],
          regularRewards,
          regularRewards
        ]
      }
    })

    const { gasPrice } = await getGasPriceRecommendations(provider, network)
    const recommendations = gasPrice as Gas1559Recommendation[]

    expect(getByName(recommendations, 'slow').maxPriorityFeePerGas).toBe(
      ethers.parseUnits('1', 'gwei')
    )
    expect(getByName(recommendations, 'medium').maxPriorityFeePerGas).toBe(
      ethers.parseUnits('1.2', 'gwei')
    )
    expect(getByName(recommendations, 'fast').maxPriorityFeePerGas).toBe(
      ethers.parseUnits('1.4', 'gwei')
    )
    expect(getByName(recommendations, 'ape').maxPriorityFeePerGas).toBe(
      ethers.parseUnits('1.8', 'gwei')
    )
    provider.destroy()
  })

  test('should cap priority fee percentiles relative to slow', async () => {
    const provider = MockProvider.init({
      ethMaxPriorityFeePerGas: 100n,
      feeHistory: {
        reward: Array.from({ length: 5 }, () => [
          ethers.parseUnits('1', 'gwei'),
          ethers.parseUnits('10', 'gwei'),
          ethers.parseUnits('20', 'gwei'),
          ethers.parseUnits('40', 'gwei')
        ])
      }
    })

    const { gasPrice } = await getGasPriceRecommendations(provider, network)
    const recommendations = gasPrice as Gas1559Recommendation[]

    expect(getByName(recommendations, 'medium').maxPriorityFeePerGas).toBe(
      ethers.parseUnits('1.25', 'gwei')
    )
    expect(getByName(recommendations, 'fast').maxPriorityFeePerGas).toBe(
      ethers.parseUnits('1.5', 'gwei')
    )
    expect(getByName(recommendations, 'ape').maxPriorityFeePerGas).toBe(
      ethers.parseUnits('2', 'gwei')
    )
    provider.destroy()
  })
})
