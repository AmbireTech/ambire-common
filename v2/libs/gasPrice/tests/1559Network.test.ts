// https://eips.ethereum.org/EIPS/eip-1559
import { ethers } from "ethers"
import MockProvider from "./MockProvider"
import { getGasPriceRecommendations } from "../gasPrice"
import { describe, expect, test } from "@jest/globals"

describe('1559 Network gas price tests', function() {
  test('should make a prediction for a previous block of 30M gas (max), should increase the baseFeePerGas by 12.5% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async function(){
    const params = {
      gasUsed: 30000000n
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)

    const expectations = {
      slow: ethers.parseUnits('1.125', 'gwei'),
      medium: ethers.parseUnits('1.18125', 'gwei'),
      fast: ethers.parseUnits('1.2375', 'gwei'),
      ape: ethers.parseUnits('1.29375', 'gwei'),
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
  test('should make a prediction for a previous block of 15M gas (the target gas), should not change the baseFeePerGas from the previous block for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async function(){
    const params = {
      gasUsed: 15000000n
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)

    const expectations = {
      slow: ethers.parseUnits('1', 'gwei'),
      medium: ethers.parseUnits('1.05', 'gwei'),
      fast: ethers.parseUnits('1.1', 'gwei'),
      ape: ethers.parseUnits('1.15', 'gwei'),
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
  test('should make a prediction for an empty previous block, should decrease the baseFeePerGas by 12.5% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async function(){
    const params = {
      gasUsed: 0n
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)

    const expectations = {
      slow: ethers.parseUnits('0.875', 'gwei'),
      medium: ethers.parseUnits('0.91875', 'gwei'),
      fast: ethers.parseUnits('0.9625', 'gwei'),
      ape: ethers.parseUnits('1.00625', 'gwei'),
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
  test('should make a prediction for a previous block of 10M gas, should decrease the baseFeePerGas by 4.16% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async function(){
    const params = {
      gasUsed: 10000000n
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)

    const delta = 41666666n
    // 958333334
    const expectations = {
      slow: ethers.parseUnits('0.958333334', 'gwei'),
      medium: ethers.parseUnits('1.006250000', 'gwei'),
      fast: ethers.parseUnits('1.054166667', 'gwei'),
      ape: ethers.parseUnits('1.102083334', 'gwei'),
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
  test('should make a prediction for a previous block of 18.5M gas, should increase the gas by 2.9% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async function(){
    const params = {
      gasUsed: 18500000n
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)

    // const delta = ethers.parseUnits('1', 'gwei') * (params.gasUsed - gasTarget) / gasTarget / 8n
    const delta = 29166666n
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
      },
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
  test('should return the lowest maxPriorityFeePerGas for a block with less than 4 txns', async function(){
    const params = {
      transactions: [
        { maxPriorityFeePerGas: 100n },
        { maxPriorityFeePerGas: 98n },
        { maxPriorityFeePerGas: 99n }
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const expectations = {
      slow: {
        maxPriorityFeePerGas: 98n,
      },
      medium: {
        maxPriorityFeePerGas: 98n,
      },
      fast: {
        maxPriorityFeePerGas: 98n,
      },
      ape: {
        maxPriorityFeePerGas: 98n,
      },
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
  test('makes a maxPriorityFeePerGas prediction with an empty block and returns 0n for maxPriorityFeePerGas', async function(){
    const params = {
      transactions: []
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(0n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(0n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(0n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(0n)
  })
  test('should remove an outlier from a group of 17, making the group 16, and calculate average at a step of 4, disregarding none', async function(){
    const params = {
      transactions: [
        { maxPriorityFeePerGas: 10n },
        { maxPriorityFeePerGas: 10n },
        { maxPriorityFeePerGas: 10n },
        { maxPriorityFeePerGas: 10n },
        { maxPriorityFeePerGas: 10n },
        { maxPriorityFeePerGas: 10n },
        { maxPriorityFeePerGas: 10n },
        { maxPriorityFeePerGas: 10n },
        { maxPriorityFeePerGas: 10n },
        { maxPriorityFeePerGas: 10n },
        { maxPriorityFeePerGas: 10n },
        { maxPriorityFeePerGas: 50n },
        { maxPriorityFeePerGas: 50n },
        { maxPriorityFeePerGas: 50n },
        { maxPriorityFeePerGas: 100n },
        { maxPriorityFeePerGas: 100n },
        { maxPriorityFeePerGas: 10000n }, // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(10n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(10n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(20n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(75n)
  })
  test('should remove outliers from a group of 19, making the group 15, and return an average for each speed at a step of 3 for slow, medium and fast, and an avg of the remaining 6 for ape', async function(){
    const params = {
      transactions: [
        { maxPriorityFeePerGas: 1n }, // removed as an outlier
        { maxPriorityFeePerGas: 1n }, // removed as an outlier
        { maxPriorityFeePerGas: 100n },
        { maxPriorityFeePerGas: 100n },
        { maxPriorityFeePerGas: 100n },
        { maxPriorityFeePerGas: 110n },
        { maxPriorityFeePerGas: 110n },
        { maxPriorityFeePerGas: 110n },
        { maxPriorityFeePerGas: 110n },
        { maxPriorityFeePerGas: 110n },
        { maxPriorityFeePerGas: 110n },
        { maxPriorityFeePerGas: 110n },
        { maxPriorityFeePerGas: 120n },
        { maxPriorityFeePerGas: 120n },
        { maxPriorityFeePerGas: 120n },
        { maxPriorityFeePerGas: 150n },
        { maxPriorityFeePerGas: 150n },
        { maxPriorityFeePerGas: 10000n }, // removed as an outlier
        { maxPriorityFeePerGas: 20000n }, // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(100n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(110n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(110n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(128n)
  })
  test('should remove 0s from maxPriorityFeePerGas but should keep 1s because they are not outliers, and should calculate an average of every group of 4 for slow, medium and fast, and an average of the remaining 5 for ape', async function(){
    const params = {
      transactions: [
        { maxPriorityFeePerGas: 0n }, // removed because no 0s are allowed
        { maxPriorityFeePerGas: 0n }, // removed because no 0s are allowed
        { maxPriorityFeePerGas: 0n }, // removed because no 0s are allowed
        { maxPriorityFeePerGas: 1n },
        { maxPriorityFeePerGas: 1n },
        { maxPriorityFeePerGas: 40n },
        { maxPriorityFeePerGas: 40n },
        { maxPriorityFeePerGas: 45n },
        { maxPriorityFeePerGas: 50n },
        { maxPriorityFeePerGas: 50n },
        { maxPriorityFeePerGas: 50n },
        { maxPriorityFeePerGas: 55n },
        { maxPriorityFeePerGas: 55n },
        { maxPriorityFeePerGas: 55n },
        { maxPriorityFeePerGas: 55n },
        { maxPriorityFeePerGas: 70n },
        { maxPriorityFeePerGas: 70n },
        { maxPriorityFeePerGas: 72n },
        { maxPriorityFeePerGas: 85n },
        { maxPriorityFeePerGas: 85n },
        { maxPriorityFeePerGas: 500n }, // removed as an outlier
        { maxPriorityFeePerGas: 500n }, // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).toBe(20n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).toBe(48n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).toBe(55n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).toBe(76n)
  })
})