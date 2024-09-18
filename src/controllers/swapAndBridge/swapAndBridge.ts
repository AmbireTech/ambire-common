import { TokenResult } from '../../libs/portfolio'
import EventEmitter from '../eventEmitter/eventEmitter'

export class SwapAndBridgeController extends EventEmitter {
  fromTokenAddress: TokenResult['address'] | null = null

  fromTokenNetwork: TokenResult['networkId'] | null = null

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
