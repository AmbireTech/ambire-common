// https://eips.ethereum.org/EIPS/eip-1559
import { Block, BlockTag, FetchRequest, JsonRpcApiProviderOptions, JsonRpcProvider, Networkish, ethers } from "ethers"
import { abiCoder, addressOne, localhost } from "../config"
import { getGasPriceRecommendations } from "../../v2/libs/gasprice/gasprice"
import { expect } from "chai";
const speeds = [
	{ baseFeeAddBps: 0n },
	{ baseFeeAddBps: 500n },
	{ baseFeeAddBps: 1000n },
	{ baseFeeAddBps: 1500n },
]

class MockProvider extends JsonRpcProvider {

  blockParams: any;

  constructor(url?: string | FetchRequest, network?: Networkish, options?: JsonRpcApiProviderOptions, blockParams: any = {}) {
    super(url, network, options)
    this.blockParams = blockParams
  }

  async getBlock(block: BlockTag | string, prefetchTxs?: boolean): Promise<null | Block> {

    const params = {
      hash: this.blockParams.hash ?? null,
      number: this.blockParams.number ?? 0,
      timestamp: this.blockParams.timestamp ?? 30000000,
      parentHash: this.blockParams.parentHash ?? ethers.keccak256(abiCoder.encode(['string'], ['random hash'])),
      nonce: this.blockParams.nonce ?? '0',
      difficulty: this.blockParams.difficulty ?? ethers.toBigInt(1),
      gasLimit: this.blockParams.gasLimit ?? ethers.toBigInt(30000000),
      gasUsed: this.blockParams.gasUsed ?? ethers.toBigInt(30000000),
      miner: this.blockParams.miner ?? addressOne,
      extraData: this.blockParams.extraData ?? 'extra data',
      baseFeePerGas: this.blockParams.baseFeePerGas ?? ethers.parseUnits('1', 'gwei'),
      transactions: this.blockParams.transactions ?? []
    }
    return new Block(params, this)
  }
}

describe('1559 Network gas price tests', function() {
  it('makes a basic gas price prediction when the base fee is exactly 15M', async function(){
    const baseFee = ethers.parseUnits('1', 'gwei')
    const params = {
      baseFeePerGas: baseFee,
      gasLimit: ethers.toBigInt(30000000),
      gasUsed: ethers.toBigInt(30000000)
    }
    const provider = new MockProvider(localhost, 1, {}, params)
    const gasPrice = await getGasPriceRecommendations(provider)

    const expectedBaseFee = baseFee + baseFee / ethers.toBigInt(8)
    let entered4times = 0
    speeds.map(({baseFeeAddBps}, i) => {
      let currentSpeed: any = gasPrice[i]
      expect(currentSpeed).to.have.property('baseFeePerGas')
      expect(currentSpeed.baseFeePerGas).to.equal(expectedBaseFee + expectedBaseFee * baseFeeAddBps / 10000n)
      entered4times++
    })
    expect(entered4times).to.equal(4)
  })
})