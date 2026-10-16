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

    // slow, medium, fast and ape tolerate 1, 2, 5 and 12 full blocks (+12.5% base fee each)
    expect(getByName(gasPrice, 'slow')).toEqual({
      name: 'slow',
      baseFeePerGas: ethers.parseUnits('1.35', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei')
    })
    expect(getByName(gasPrice, 'medium')).toEqual({
      name: 'medium',
      baseFeePerGas: ethers.parseUnits('1.51875', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1.25', 'gwei')
    })
    expect(getByName(gasPrice, 'fast')).toEqual({
      name: 'fast',
      // 2.16243896484375 gwei, rounded down to wei
      baseFeePerGas: 2162438964n,
      maxPriorityFeePerGas: ethers.parseUnits('1.5', 'gwei')
    })
    expect(getByName(gasPrice, 'ape')).toEqual({
      name: 'ape',
      // 1.2 gwei * 1.125^12, rounded down to wei on each block
      baseFeePerGas: 4931868801n,
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

    // slow, medium, fast and ape tolerate 1, 2, 5 and 12 full blocks (+12.5% base fee each)
    expect(getByName(gasPrice, 'slow')).toEqual({
      name: 'slow',
      baseFeePerGas: ethers.parseUnits('1.35', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei')
    })
    expect(getByName(gasPrice, 'medium')).toEqual({
      name: 'medium',
      baseFeePerGas: ethers.parseUnits('1.51875', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1.125', 'gwei')
    })
    expect(getByName(gasPrice, 'fast')).toEqual({
      name: 'fast',
      // 2.16243896484375 gwei, rounded down to wei
      baseFeePerGas: 2162438964n,
      maxPriorityFeePerGas: ethers.parseUnits('1.25', 'gwei')
    })
    expect(getByName(gasPrice, 'ape')).toEqual({
      name: 'ape',
      // 1.2 gwei * 1.125^12, rounded down to wei on each block
      baseFeePerGas: 4931868801n,
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

    expect(getByName(gasPrice, 'slow').baseFeePerGas).toBe(ethers.parseUnits('1.125', 'gwei'))
    expect(getByName(gasPrice, 'medium').baseFeePerGas).toBe(
      ethers.parseUnits('1.265625', 'gwei')
    )
    // 1.802032470703125 gwei, rounded down to wei
    expect(getByName(gasPrice, 'fast').baseFeePerGas).toBe(1802032470n)
    // 1 gwei * 1.125^12, rounded down to wei on each block
    expect(getByName(gasPrice, 'ape').baseFeePerGas).toBe(4109890668n)
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

  test('should keep the max fee above the base fee for the tolerated number of full blocks', async () => {
    const nextBlockBaseFee = ethers.parseUnits('10', 'gwei')
    const provider = MockProvider.init({
      ethMaxPriorityFeePerGas: 100n,
      feeHistory: {
        baseFeePerGas: Array.from({ length: 6 }, () => nextBlockBaseFee),
        reward: Array.from({ length: 5 }, () => [100000n, 200000n, 300000n, 500000n])
      }
    })

    const { gasPrice } = await getGasPriceRecommendations(provider, network)
    const recommendations = gasPrice as Gas1559Recommendation[]
    const getBaseFeeAfterFullBlocks = (fullBlocks: number) =>
      Array.from({ length: fullBlocks }).reduce<bigint>((fee) => fee + fee / 8n, nextBlockBaseFee)
    const toleratedFullBlocksBySpeed = { slow: 1, medium: 2, fast: 5, ape: 12 }

    Object.entries(toleratedFullBlocksBySpeed).forEach(([name, toleratedFullBlocks]) => {
      const { baseFeePerGas } = getByName(recommendations, name)

      expect(baseFeePerGas >= getBaseFeeAfterFullBlocks(toleratedFullBlocks)).toBe(true)
      expect(baseFeePerGas < getBaseFeeAfterFullBlocks(toleratedFullBlocks + 1)).toBe(true)
    })
    provider.destroy()
  })
})
