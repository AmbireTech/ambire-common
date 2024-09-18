import { TokenResult } from '../../libs/portfolio'
import EventEmitter from '../eventEmitter/eventEmitter'

export class SwapAndBridgeController extends EventEmitter {
  fromTokenAddress: TokenResult['address'] | null = '0x0000000000000000000000000000000000000000' // temporary hardcoded as default

  fromTokenNetworkId: TokenResult['networkId'] | null = 'ethereum' // temporary hardcoded as default

  constructor() {
    super()

    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this
    }
  }
}
