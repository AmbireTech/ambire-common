// https://eips.ethereum.org/EIPS/eip-1559
import { ethers } from "ethers"
import { expect } from "../config"
import { getGasPriceRecommendations } from "../../v2/libs/gasprice/gasprice"
import MockProvider from "./MockProvider"

describe('1559 Network gas price tests', function() {
  it('makes a gas price prediction with gasUsed 30M, base fee should increase by 12.5%', async function(){
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
  it('makes a gas price prediction with gasUsed 15M, base fee should stay the same', async function(){
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
  it('makes a gas price prediction with gasUsed 0M, base fee decrease by 12.5%', async function(){
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
  it('makes a gas price prediction with gasUsed 10M', async function(){
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
  it('makes a gas price prediction with gasUsed 18M 500K', async function(){
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
  it('makes a maxPriorityFeePerGas prediction with below 4 transactions without outliers and make sure it returns 1n for maxPriorityFeePerGas', async function(){
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
        maxPriorityFeePerGas: 0n,
      },
      medium: {
        maxPriorityFeePerGas: 0n,
      },
      fast: {
        maxPriorityFeePerGas: 0n,
      },
      ape: {
        maxPriorityFeePerGas: 0n,
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
  it('makes a maxPriorityFeePerGas prediction with 4 transactions but one is an outlier and still returns 1n', async function(){
    // total: 17 txns
    // the last will get removed - remaining 16
    // 4 per speed step
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
        { maxPriorityFeePerGas: 10000n }, // this should get removed
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
  it('makes a maxPriorityFeePerGas prediction with 4 transactions but one is an outlier and still returns 1n', async function(){
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
})