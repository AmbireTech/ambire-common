import EventEmitter from '../eventEmitter/eventEmitter'

export class SwapAndBridgeController extends EventEmitter {
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
