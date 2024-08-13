// https://eips.ethereum.org/EIPS/eip-1559
import { ethers } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { networks } from '../../../consts/networks'
import { getGasPriceRecommendations } from '../gasPrice'
import MockProvider from './MockProvider'

const network = networks.find((net) => net.id === 'ethereum')!

describe('1559 Network gas price tests', () => {
  test('should make a prediction for a previous block of 30M gas (max), should increase the baseFeePerGas by 12.5% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async () => {
    const params = {
      gasUsed: 30000000n
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider, network)

    const expectations = {
      slow: ethers.parseUnits('1.125', 'gwei'),
      medium: ethers.parseUnits('1.18125', 'gwei'),
      fast: ethers.parseUnits('1.2375', 'gwei'),
      ape: ethers.parseUnits('1.29375', 'gwei')
    }
    const slow: any = gasPrice[0]
    expect(slow.baseFeePerGas).toBe(expectations.slow)
    const medium: any = gasPrice[1]
    expect(medium.baseFeePerGas).toBe(expectations.medium)
    const fast: any = gasPrice[2]
    expect(fast.baseFeePerGas).toBe(expectations.fast)
    const ape: any = gasPrice[3]
    expect(ape.baseFeePerGas).toBe(expectations.ape)
  })
  test('should make a prediction for a previous block of 15M gas (the target gas), should not change the baseFeePerGas from the previous block for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async () => {
    const params = {
      gasUsed: 15000000n
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider, network)

    const expectations = {
      slow: ethers.parseUnits('1', 'gwei'),
      medium: ethers.parseUnits('1.05', 'gwei'),
      fast: ethers.parseUnits('1.1', 'gwei'),
      ape: ethers.parseUnits('1.15', 'gwei')
    }
    const slow: any = gasPrice[0]
    expect(slow.baseFeePerGas).toBe(expectations.slow)
    const medium: any = gasPrice[1]
    expect(medium.baseFeePerGas).toBe(expectations.medium)
    const fast: any = gasPrice[2]
    expect(fast.baseFeePerGas).toBe(expectations.fast)
    const ape: any = gasPrice[3]
    expect(ape.baseFeePerGas).toBe(expectations.ape)
  })
  test('should make a prediction for an empty previous block, should decrease the baseFeePerGas by 12.5% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async () => {
    const params = {
      gasUsed: 0n
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider, network)

    const expectations = {
      slow: ethers.parseUnits('0.875', 'gwei'),
      medium: ethers.parseUnits('0.91875', 'gwei'),
      fast: ethers.parseUnits('0.9625', 'gwei'),
      ape: ethers.parseUnits('1.00625', 'gwei')
    }
    const slow: any = gasPrice[0]
    expect(slow.baseFeePerGas).toBe(expectations.slow)
    const medium: any = gasPrice[1]
    expect(medium.baseFeePerGas).toBe(expectations.medium)
    const fast: any = gasPrice[2]
    expect(fast.baseFeePerGas).toBe(expectations.fast)
    const ape: any = gasPrice[3]
    expect(ape.baseFeePerGas).toBe(expectations.ape)
  })
  test('should make a prediction for a previous block of 10M gas, should decrease the baseFeePerGas by 4.16% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async () => {
    const params = {
      gasUsed: 10000000n
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider, network)

    // 958333334
    const expectations = {
      slow: ethers.parseUnits('0.958333334', 'gwei'),
      medium: ethers.parseUnits('1.006250000', 'gwei'),
      fast: ethers.parseUnits('1.054166667', 'gwei'),
      ape: ethers.parseUnits('1.102083334', 'gwei')
    }
    const slow: any = gasPrice[0]
    expect(slow.baseFeePerGas).toBe(expectations.slow)
    const medium: any = gasPrice[1]
    expect(medium.baseFeePerGas).toBe(expectations.medium)
    const fast: any = gasPrice[2]
    expect(fast.baseFeePerGas).toBe(expectations.fast)
    const ape: any = gasPrice[3]
    expect(ape.baseFeePerGas).toBe(expectations.ape)
  })
  test('should make a prediction for a previous block of 18.5M gas, should increase the gas by 2.9% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async () => {
    const params = {
      gasUsed: 18500000n
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider, network)

    // const delta = ethers.parseUnits('1', 'gwei') * (params.gasUsed - gasTarget) / gasTarget / 8n
    const expectations = {
      slow: {
        gasPrice: ethers.parseUnits('1.029166666', 'gwei')
      },
      medium: {
        gasPrice: ethers.parseUnits('1.080624999', 'gwei')
      },
      fast: {
        gasPrice: ethers.parseUnits('1.132083332', 'gwei')
      },
      ape: {
        gasPrice: ethers.parseUnits('1.183541665', 'gwei')
      }
    }
    const slow: any = gasPrice[0]
    expect(slow.baseFeePerGas).toBe(expectations.slow.gasPrice)
    const medium: any = gasPrice[1]
    expect(medium.baseFeePerGas).toBe(expectations.medium.gasPrice)
    const fast: any = gasPrice[2]
    expect(fast.baseFeePerGas).toBe(expectations.fast.gasPrice)
    const ape: any = gasPrice[3]
    expect(ape.baseFeePerGas).toBe(expectations.ape.gasPrice)
  })
  test('should return the lowest maxPriorityFeePerGas for a block with less than 4 txns', async () => {
    const params = {
      transactions: [
        { maxPriorityFeePerGas: 300n },
        { maxPriorityFeePerGas: 252n },
        { maxPriorityFeePerGas: 252n }
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider, network)
    const expectations = {
      slow: {
        maxPriorityFeePerGas: 252n
      },
      medium: {
        maxPriorityFeePerGas: 283n // 12% more
      },
      fast: {
        maxPriorityFeePerGas: 318n // 12% more
      },
      ape: {
        maxPriorityFeePerGas: 357n // 12% more
      }
    }
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(expectations.slow.maxPriorityFeePerGas)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(expectations.medium.maxPriorityFeePerGas)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(expectations.fast.maxPriorityFeePerGas)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(expectations.ape.maxPriorityFeePerGas)
  })
  test('makes a maxPriorityFeePerGas prediction with an empty block and returns 200n for slow as that is the minimum but 12% more for each after', async () => {
    const params = {
      transactions: []
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider, network)
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(200n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(225n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(253n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(284n)
  })
  test('should remove an outlier from a group of 17, making the group 16, and calculate average at a step of 4, disregarding none', async () => {
    const params = {
      transactions: [
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 250n },
        { maxPriorityFeePerGas: 250n },
        { maxPriorityFeePerGas: 300n },
        { maxPriorityFeePerGas: 400n },
        { maxPriorityFeePerGas: 400n },
        { maxPriorityFeePerGas: 1000000n } // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider, network)
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(210n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(236n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(265n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(337n)
  })
  test('should remove outliers from a group of 19, making the group 15, and return an average for each speed at a step of 3 for slow, medium and fast, and an avg of the remaining 6 for ape', async () => {
    const params = {
      transactions: [
        { maxPriorityFeePerGas: 1n }, // removed as an outlier
        { maxPriorityFeePerGas: 1n }, // removed as an outlier
        { maxPriorityFeePerGas: 200n },
        { maxPriorityFeePerGas: 200n },
        { maxPriorityFeePerGas: 200n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 210n },
        { maxPriorityFeePerGas: 220n },
        { maxPriorityFeePerGas: 220n },
        { maxPriorityFeePerGas: 220n },
        { maxPriorityFeePerGas: 250n },
        { maxPriorityFeePerGas: 250n },
        { maxPriorityFeePerGas: 10000n }, // removed as an outlier
        { maxPriorityFeePerGas: 20000n } // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider, network)
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(200n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(225n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(253n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(284n)
  })
  test('should remove 0s from maxPriorityFeePerGas but should keep 1s because they are not outliers, and should calculate an average of every group of 4 for slow, medium and fast, and an average of the remaining 5 for ape', async () => {
    const params = {
      transactions: [
        { maxPriorityFeePerGas: 0n }, // removed because no 0s are allowed
        { maxPriorityFeePerGas: 0n }, // removed because no 0s are allowed
        { maxPriorityFeePerGas: 0n }, // removed because no 0s are allowed
        { maxPriorityFeePerGas: 201n },
        { maxPriorityFeePerGas: 201n },
        { maxPriorityFeePerGas: 240n },
        { maxPriorityFeePerGas: 240n },
        { maxPriorityFeePerGas: 245n },
        { maxPriorityFeePerGas: 250n },
        { maxPriorityFeePerGas: 250n },
        { maxPriorityFeePerGas: 250n },
        { maxPriorityFeePerGas: 255n },
        { maxPriorityFeePerGas: 255n },
        { maxPriorityFeePerGas: 255n },
        { maxPriorityFeePerGas: 255n },
        { maxPriorityFeePerGas: 270n },
        { maxPriorityFeePerGas: 270n },
        { maxPriorityFeePerGas: 272n },
        { maxPriorityFeePerGas: 285n },
        { maxPriorityFeePerGas: 285n },
        { maxPriorityFeePerGas: 2500n }, // removed as an outlier
        { maxPriorityFeePerGas: 2500n } // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider, network)
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(220n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(248n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(279n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(313n)
  })
})
