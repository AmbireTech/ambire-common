// https://eips.ethereum.org/EIPS/eip-1559
import { ethers } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { suppressConsoleBeforeEach } from '../../../../test/helpers/console'
import { networks } from '../../../consts/networks'
import { getGasPriceRecommendations } from '../gasPrice'
import MockProvider from './MockProvider'

const network = networks.find((net) => net.chainId === 1n)!

describe('1559 Network gas price tests', () => {
  // Mock providers throw errors we can ignore
  suppressConsoleBeforeEach()
  test('should make a prediction for a previous block of 30M gas (max), should increase the baseFeePerGas by 12.5% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async () => {
    const params = {
      gasUsed: 30000000n
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice

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
    provider.destroy()
  })
  test('should make a prediction for a previous block of 15M gas (the target gas), should not change the baseFeePerGas from the previous block for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async () => {
    const params = {
      gasUsed: 15000000n
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice

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
    provider.destroy()
  })
  test('should make a prediction for an empty previous block, should NOT decrease the baseFeePerGas as we do not decrease it anymore, set slow to the base gas and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async () => {
    const params = {
      gasUsed: 0n
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice

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
    provider.destroy()
  })
  test('should make a prediction for a previous block of 10M gas, should NOT decrease the baseFeePerGas for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async () => {
    const params = {
      gasUsed: 10000000n
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice

    // 958333334
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
    provider.destroy()
  })
  test('should make a prediction for a previous block of 18.5M gas, should increase the gas by 2.9% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async () => {
    const params = {
      gasUsed: 18500000n
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice

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
    provider.destroy()
  })
  test('should return the lowest maxPriorityFeePerGas for a block with less than 4 txns', async () => {
    const params = {
      transactions: [
        { maxPriorityFeePerGas: 101000n },
        { maxPriorityFeePerGas: 100100n },
        { maxPriorityFeePerGas: 100100n }
      ]
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const expectations = {
      slow: {
        maxPriorityFeePerGas: 100100n
      },
      medium: {
        maxPriorityFeePerGas: 112612n // 12% more
      },
      fast: {
        maxPriorityFeePerGas: 126688n // 12% more
      },
      ape: {
        maxPriorityFeePerGas: 190032n // 12% more
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
    provider.destroy()
  })
  test('makes a maxPriorityFeePerGas prediction with an empty block and returns 200n for slow as that is the minimum but 12% more for each after', async () => {
    const params = {
      transactions: []
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(100000n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(112500n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(126562n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(189843n)
    provider.destroy()
  })
  test('should remove an outlier from a group of 17, making the group 16, and calculate average at a step of 4, disregarding none', async () => {
    const params = {
      transactions: [
        { maxPriorityFeePerGas: 100100n },
        { maxPriorityFeePerGas: 100100n },
        { maxPriorityFeePerGas: 100100n },
        { maxPriorityFeePerGas: 100100n },
        { maxPriorityFeePerGas: 100100n },
        { maxPriorityFeePerGas: 100100n },
        { maxPriorityFeePerGas: 100100n },
        { maxPriorityFeePerGas: 100100n },
        { maxPriorityFeePerGas: 100100n },
        { maxPriorityFeePerGas: 100100n },
        { maxPriorityFeePerGas: 100100n },
        { maxPriorityFeePerGas: 100500n },
        { maxPriorityFeePerGas: 100500n },
        { maxPriorityFeePerGas: 103000n },
        { maxPriorityFeePerGas: 104000n },
        { maxPriorityFeePerGas: 104000n },
        { maxPriorityFeePerGas: 100000000000n } // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(100100n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(112612n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(126688n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(190032n)
    provider.destroy()
  })
  test('should remove outliers from a group of 19, making the group 15, and return an average for each speed at a step of 3 for slow, medium and fast, and an avg of the remaining 6 for ape', async () => {
    const params = {
      transactions: [
        { maxPriorityFeePerGas: 1n }, // removed as an outlier
        { maxPriorityFeePerGas: 1n }, // removed as an outlier
        { maxPriorityFeePerGas: 100200n },
        { maxPriorityFeePerGas: 100200n },
        { maxPriorityFeePerGas: 100200n },
        { maxPriorityFeePerGas: 100210n },
        { maxPriorityFeePerGas: 100210n },
        { maxPriorityFeePerGas: 100210n },
        { maxPriorityFeePerGas: 100210n },
        { maxPriorityFeePerGas: 100210n },
        { maxPriorityFeePerGas: 100210n },
        { maxPriorityFeePerGas: 100210n },
        { maxPriorityFeePerGas: 100220n },
        { maxPriorityFeePerGas: 100220n },
        { maxPriorityFeePerGas: 100220n },
        { maxPriorityFeePerGas: 100250n },
        { maxPriorityFeePerGas: 100250n },
        { maxPriorityFeePerGas: 10000000000n }, // removed as an outlier
        { maxPriorityFeePerGas: 20000000000n } // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(100200n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(112725n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(126815n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(190222n)
    provider.destroy()
  })
  test('should remove 0s from maxPriorityFeePerGas but should keep 1s because they are not outliers, and should calculate an average of every group of 4 for slow, medium and fast, and an average of the remaining 5 for ape', async () => {
    const params = {
      transactions: [
        { maxPriorityFeePerGas: 0n }, // removed because no 0s are allowed
        { maxPriorityFeePerGas: 0n }, // removed because no 0s are allowed
        { maxPriorityFeePerGas: 0n }, // removed because no 0s are allowed
        { maxPriorityFeePerGas: 100201n },
        { maxPriorityFeePerGas: 100201n },
        { maxPriorityFeePerGas: 100240n },
        { maxPriorityFeePerGas: 100240n },
        { maxPriorityFeePerGas: 100245n },
        { maxPriorityFeePerGas: 100250n },
        { maxPriorityFeePerGas: 100250n },
        { maxPriorityFeePerGas: 100250n },
        { maxPriorityFeePerGas: 100255n },
        { maxPriorityFeePerGas: 100255n },
        { maxPriorityFeePerGas: 100255n },
        { maxPriorityFeePerGas: 100255n },
        { maxPriorityFeePerGas: 100270n },
        { maxPriorityFeePerGas: 100270n },
        { maxPriorityFeePerGas: 100272n },
        { maxPriorityFeePerGas: 100285n },
        { maxPriorityFeePerGas: 100285n },
        { maxPriorityFeePerGas: 10028500n }, // removed as an outlier
        { maxPriorityFeePerGas: 10128500 } // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPriceData = await getGasPriceRecommendations(provider, network)
    const gasPrice = gasPriceData.gasPrice
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(100220n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(112747n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(126840n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(190260n)
    provider.destroy()
  })
})
