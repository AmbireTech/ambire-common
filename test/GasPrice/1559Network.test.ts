// https://eips.ethereum.org/EIPS/eip-1559
import { Block, BlockTag, FetchRequest, JsonRpcApiProviderOptions, JsonRpcProvider, Networkish, ethers } from "ethers"
import { abiCoder, addressOne, expect, localhost } from "../config"
import { getGasPriceRecommendations } from "../../v2/libs/gasprice/gasprice"
const speeds = [
	{ baseFeeAddBps: 0n },
	{ baseFeeAddBps: 500n },
	{ baseFeeAddBps: 1000n },
	{ baseFeeAddBps: 1500n },
]
const ELASTICITY_MULTIPLIER = 2n
const gasLimit = 30000000n
const gasTarget = gasLimit / ELASTICITY_MULTIPLIER

class MockProvider extends JsonRpcProvider {

  blockParams: any;

  constructor(url?: string | FetchRequest, network?: Networkish, options?: JsonRpcApiProviderOptions, blockParams: any = {}) {
    super(url, network, options)
    this.blockParams = blockParams
  }

  static init(params: {}): MockProvider {
    return new MockProvider(localhost, 1, {}, params)
  }

  async getBlock(block: BlockTag | string, prefetchTxs?: boolean): Promise<null | Block> {

    const params = {
      hash: this.blockParams.hash ?? null,
      number: this.blockParams.number ?? 0,
      timestamp: this.blockParams.timestamp ?? 30000000,
      parentHash: this.blockParams.parentHash ?? ethers.keccak256(abiCoder.encode(['string'], ['random hash'])),
      nonce: this.blockParams.nonce ?? '0',
      difficulty: this.blockParams.difficulty ?? 1n,
      gasLimit: this.blockParams.gasLimit ?? gasLimit,
      gasUsed: this.blockParams.gasUsed ?? 30000000n,
      miner: this.blockParams.miner ?? addressOne,
      extraData: this.blockParams.extraData ?? 'extra data',
      baseFeePerGas: this.blockParams.baseFeePerGas ?? ethers.parseUnits('1', 'gwei'),
      transactions: this.blockParams.transactions ?? []
    }
    return new Block(params, this)
  }
}

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
        maxPriorityFeePerGas: 1n,
      },
      medium: {
        maxPriorityFeePerGas: 1n,
      },
      fast: {
        maxPriorityFeePerGas: 1n,
      },
      ape: {
        maxPriorityFeePerGas: 1n,
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
  it('makes a maxPriorityFeePerGas prediction with an empty block and returns 1n for maxPriorityFeePerGas', async function(){
    const params = {
      transactions: []
    }
    const provider = MockProvider.init(params)
    const gasPrice = await getGasPriceRecommendations(provider)
    const slow: any = gasPrice[0]
    expect(slow.maxPriorityFeePerGas).to.equal(1n)
    const medium: any = gasPrice[1]
    expect(medium.maxPriorityFeePerGas).to.equal(1n)
    const fast: any = gasPrice[2]
    expect(fast.maxPriorityFeePerGas).to.equal(1n)
    const ape: any = gasPrice[3]
    expect(ape.maxPriorityFeePerGas).to.equal(1n)
  })
  it('makes a maxPriorityFeePerGas prediction with 4 transactions but one is an outlier and still returns 1n', async function(){
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
        { maxPriorityFeePerGas: 10000n }, // this will get removed
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
})