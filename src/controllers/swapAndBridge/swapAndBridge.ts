import { Fetch } from '../../interfaces/fetch'
import { TokenResult } from '../../libs/portfolio'
import { SocketAPI } from '../../services/socket/api'
import EventEmitter from '../eventEmitter/eventEmitter'

export class SwapAndBridgeController extends EventEmitter {
  #socketAPI: SocketAPI

  fromTokenAddress: TokenResult['address'] | null = '0x0000000000000000000000000000000000000000' // temporary hardcoded as default

  fromChainId: number | null = 1 // temporary hardcoded as default

  toTokenAddress: TokenResult['address'] | null = null

  toChainId: number | null = 1 // temporary hardcoded as default

  toTokenList: {
    address: TokenResult['address']
    chainId: number
    decimals: number
    logoURI: string
    name: string
    symbol: string
  }[] = []

  constructor({ fetch }: { fetch: Fetch }) {
    super()
    this.#socketAPI = new SocketAPI({ fetch })

    this.emitUpdate()
  }

  async updateToTokenList() {
    if (this.fromChainId === null || this.toChainId === null) return

    this.toTokenList = await this.#socketAPI.getToTokenList({
      fromChainId: this.fromChainId,
      toChainId: this.toChainId
    })
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this
    }
  }
}
