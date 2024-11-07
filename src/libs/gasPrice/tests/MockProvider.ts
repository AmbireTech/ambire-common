import {
  Block,
  BlockTag,
  FetchRequest,
  JsonRpcApiProviderOptions,
  JsonRpcProvider,
  keccak256,
  Networkish,
  parseUnits
} from 'ethers'

import { abiCoder, addressOne, localhost } from '../../../../test/config'

const gasLimit = 30000000n

export default class MockProvider extends JsonRpcProvider {
  blockParams: any

  constructor(
    url?: string | FetchRequest,
    network?: Networkish,
    options?: JsonRpcApiProviderOptions,
    blockParams: any = {}
  ) {
    super(url, network, options)
    this.blockParams = blockParams
  }

  static init(params: {}): MockProvider {
    return new MockProvider(localhost, 1, {}, params)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getBlock(block: BlockTag | string, prefetchTxs?: boolean): Promise<null | Block> {
    const params = {
      hash: this.blockParams.hash ?? null,
      number: this.blockParams.number ?? 0,
      timestamp: this.blockParams.timestamp ?? 30000000,
      parentHash:
        this.blockParams.parentHash ?? keccak256(abiCoder.encode(['string'], ['random hash'])),
      nonce: this.blockParams.nonce ?? '0',
      difficulty: this.blockParams.difficulty ?? 1n,
      gasLimit: this.blockParams.gasLimit ?? gasLimit,
      gasUsed: this.blockParams.gasUsed ?? 30000000n,
      miner: this.blockParams.miner ?? addressOne,
      extraData: this.blockParams.extraData ?? 'extra data',
      /* eslint-disable no-prototype-builtins */
      baseFeePerGas: this.blockParams.hasOwnProperty('baseFeePerGas')
        ? this.blockParams.baseFeePerGas
        : parseUnits('1', 'gwei'),
      transactions: this.blockParams.transactions ?? []
    }
    return new Block(params, this)
  }
}
