import {
  Block,
  BlockTag,
  FetchRequest,
  JsonRpcApiProviderOptions,
  JsonRpcProvider,
  keccak256,
  Networkish,
  parseUnits,
  toQuantity
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

  async getBlockNumber(): Promise<number> {
    return this.blockParams.blockNumber ?? 1
  }

  getBlockParams() {
    return {
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

      baseFeePerGas: this.blockParams.hasOwnProperty('baseFeePerGas')
        ? this.blockParams.baseFeePerGas
        : parseUnits('1', 'gwei'),
      transactions: this.blockParams.transactions ?? []
    }
  }

  async send(method: string, params: any[]): Promise<any> {
    if (method === 'eth_gasPrice') return this.blockParams.ethGasPrice ?? '0x'

    if (method === 'eth_getBlockByNumber') {
      const block = this.getBlockParams()
      return {
        ...block,
        baseFeePerGas: block.baseFeePerGas == null ? null : toQuantity(block.baseFeePerGas),
        difficulty: toQuantity(block.difficulty),
        gasLimit: toQuantity(block.gasLimit),
        gasUsed: toQuantity(block.gasUsed),
        number: toQuantity(block.number),
        timestamp: toQuantity(block.timestamp),
        transactions: block.transactions.map((txn: any) => ({
          ...txn,
          gasPrice: txn.gasPrice == null ? txn.gasPrice : toQuantity(txn.gasPrice),
          maxPriorityFeePerGas:
            txn.maxPriorityFeePerGas == null
              ? txn.maxPriorityFeePerGas
              : toQuantity(txn.maxPriorityFeePerGas)
        }))
      }
    }

    return super.send(method, params)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getBlock(block: BlockTag | string, prefetchTxs?: boolean): Promise<null | Block> {
    if (this.blockParams.getBlockError) throw this.blockParams.getBlockError

    return new Block(this.getBlockParams(), this)
  }
}
