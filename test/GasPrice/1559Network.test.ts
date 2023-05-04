// https://eips.ethereum.org/EIPS/eip-1559
import { ethers } from "ethers"
import { expect } from "../config"
import { getGasPriceRecommendations } from "../../v2/libs/gasprice/gasprice"
import MockProvider from "./MockProvider"

describe('1559 Network gas price tests', function() {
  it('should make a prediction for a previous block of 30M gas (max), should increase the baseFeePerGas by 12.5% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async function(){
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
    expect(slow.baseFeePerGas).to.equal(expectations.slow)
    const medium: any = gasPrice[1]
    expect(medium.baseFeePerGas).to.equal(expectations.medium)
    const fast: any = gasPrice[2]
    expect(fast.baseFeePerGas).to.equal(expectations.fast)
    const ape: any = gasPrice[3]
    expect(ape.baseFeePerGas).to.equal(expectations.ape)
  })
  it('should make a prediction for a previous block of 15M gas (the target gas), should not change the baseFeePerGas from the previous block for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async function(){
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
    expect(slow.baseFeePerGas).to.equal(expectations.slow)
    const medium: any = gasPrice[1]
    expect(medium.baseFeePerGas).to.equal(expectations.medium)
    const fast: any = gasPrice[2]
    expect(fast.baseFeePerGas).to.equal(expectations.fast)
    const ape: any = gasPrice[3]
    expect(ape.baseFeePerGas).to.equal(expectations.ape)
  })
  it('should make a prediction for an empty previous block, should decrease the baseFeePerGas by 12.5% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async function(){
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
    expect(slow.baseFeePerGas).to.equal(expectations.slow)
    const medium: any = gasPrice[1]
    expect(medium.baseFeePerGas).to.equal(expectations.medium)
    const fast: any = gasPrice[2]
    expect(fast.baseFeePerGas).to.equal(expectations.fast)
    const ape: any = gasPrice[3]
    expect(ape.baseFeePerGas).to.equal(expectations.ape)
  })
  it('should make a prediction for a previous block of 10M gas, should decrease the baseFeePerGas by 4.16% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async function(){
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
    expect(slow.baseFeePerGas).to.equal(expectations.slow)
    const medium: any = gasPrice[1]
    expect(medium.baseFeePerGas).to.equal(expectations.medium)
    const fast: any = gasPrice[2]
    expect(fast.baseFeePerGas).to.equal(expectations.fast)
    const ape: any = gasPrice[3]
    expect(ape.baseFeePerGas).to.equal(expectations.ape)
  })
  it('should make a prediction for a previous block of 18.5M gas, should increase the gas by 2.9% for slow, and increase gradually by baseFeeAddBps, defined in speeds in gasprice.ts for the remaining speeds', async function(){
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
    expect(slow.baseFeePerGas).to.equal(expectations.slow.gasPrice)
    const medium: any = gasPrice[1]
    expect(medium.baseFeePerGas).to.equal(expectations.medium.gasPrice)
    const fast: any = gasPrice[2]
    expect(fast.baseFeePerGas).to.equal(expectations.fast.gasPrice)
    const ape: any = gasPrice[3]
    expect(ape.baseFeePerGas).to.equal(expectations.ape.gasPrice)
  })
  it('should return the lowest maxPriorityFeePerGas for a block with less than 4 txns', async function(){
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
    expect(slow.maxPriorityFeePerGas).to.equal(expectations.slow.maxPriorityFeePerGas)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).to.equal(expectations.medium.maxPriorityFeePerGas)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).to.equal(expectations.fast.maxPriorityFeePerGas)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).to.equal(expectations.ape.maxPriorityFeePerGas)
  })
  it('makes a maxPriorityFeePerGas prediction with an empty block and returns 0n for maxPriorityFeePerGas', async function(){
    const params = {
      transactions: []
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).to.equal(0n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).to.equal(0n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).to.equal(0n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).to.equal(0n)
  })
  it('should remove an outlier from a group of 17, making the group 16, and calculate average at a step of 4, disregarding none', async function(){
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
    expect(slow.maxPriorityFeePerGas).to.equal(10n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).to.equal(10n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).to.equal(20n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).to.equal(75n)
  })
  it('should remove outliers from a group of 19, making the group 15, and return an average for each speed at a step of 3, meaning 12 of 15 will enter the calculation and the top 3 will get disregarded', async function(){
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
        { maxPriorityFeePerGas: 120n }, // disregarded as the step is 3
        { maxPriorityFeePerGas: 150n }, // disregarded as the step is 3
        { maxPriorityFeePerGas: 150n }, // disregarded as the step is 3
        { maxPriorityFeePerGas: 10000n }, // removed as an outlier
        { maxPriorityFeePerGas: 20000n }, // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).to.equal(100n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).to.equal(110n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).to.equal(110n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).to.equal(116n)
  })
  it('should remove 0s from maxPriorityFeePerGas but should keep 1s because they are not outliers, and should calculate an average of every group of 4, disregarding the 17th element', async function(){
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
        { maxPriorityFeePerGas: 85n }, // disregarded as the step is 4
        { maxPriorityFeePerGas: 500n }, // removed as an outlier
        { maxPriorityFeePerGas: 500n }, // removed as an outlier
      ]
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).to.equal(20n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).to.equal(48n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).to.equal(55n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).to.equal(74n)
  })
})