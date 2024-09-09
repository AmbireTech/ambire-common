import EventEmitter from '../eventEmitter/eventEmitter'

export class SwapController extends EventEmitter {
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
