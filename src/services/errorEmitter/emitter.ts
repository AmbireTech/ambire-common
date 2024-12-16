import EventEmitter, { ErrorRef } from '../../controllers/eventEmitter/eventEmitter'

export class ErrorEmitter {
  ctrl: EventEmitter | null = null

  init(ctrl: EventEmitter) {
    this.ctrl = ctrl
  }

  deinit() {
    this.ctrl = null
  }

  emit(error: ErrorRef) {
    if (!this.ctrl) return

    this.ctrl.emitError(error)
  }
}

// create and export a new singleton for each custom error
// emitter you want to use in the app
const estimationErrorEmitter = new ErrorEmitter()
export { estimationErrorEmitter }
