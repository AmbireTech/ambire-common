/* eslint-disable no-restricted-syntax */
import wait from '../../utils/wait'

const LIMIT_ON_THE_NUMBER_OF_ERRORS = 100

export type ErrorRef = {
  // user-friendly message, ideally containing call to action
  message: string
  // error level, used for filtering
  level: 'fatal' | 'major' | 'minor' | 'silent'
  // error containing technical details and stack trace
  error: Error
}

export default class EventEmitter {
  #callbacksWithId: {
    id: string | null
    cb: (forceEmit?: true) => void
  }[] = []

  #callbacks: ((forceEmit?: true) => void)[] = []

  #errorCallbacksWithId: {
    id: string | null
    cb: (error: ErrorRef) => void
  }[] = []

  #errorCallbacks: ((error: ErrorRef) => void)[] = []

  #errors: ErrorRef[] = []

  status: 'INITIAL' | 'LOADING' | 'SUCCESS' | 'ERROR' = 'INITIAL'

  latestMethodCall: string | null = null

  get onUpdateIds() {
    return this.#callbacksWithId.map((item) => item.id)
  }

  get onErrorIds() {
    return this.#errorCallbacksWithId.map((item) => item.id)
  }

  // called emittedErrors and not just errors because some of the other controllers
  // that extend this one have errors defined already
  get emittedErrors() {
    return this.#errors
  }

  /**
   * Using this function to emit an update bypasses both background and React batching,
   * ensuring that the state update is immediately applied at the application level (React/Extension).
   *
   * This is particularly handy when multiple status flags are being updated rapidly.
   * Without the `forceEmitUpdate` option, the application will only render the very first and last status updates,
   * batching the ones in between.
   */
  protected async forceEmitUpdate() {
    await wait(1)
    // eslint-disable-next-line no-restricted-syntax
    for (const i of this.#callbacksWithId) i.cb(true)
    // eslint-disable-next-line no-restricted-syntax
    for (const cb of this.#callbacks) cb(true)
  }

  protected emitUpdate() {
    // eslint-disable-next-line no-restricted-syntax
    for (const i of this.#callbacksWithId) i.cb()
    // eslint-disable-next-line no-restricted-syntax
    for (const cb of this.#callbacks) cb()
  }

  protected emitError(error: ErrorRef) {
    console.error(`Emitted error in: ${this.constructor.name}`, error)
    this.#errors.push(error)
    this.#trimErrorsIfNeeded()

    // eslint-disable-next-line no-restricted-syntax
    for (const i of this.#errorCallbacksWithId) i.cb(error)
    // eslint-disable-next-line no-restricted-syntax
    for (const cb of this.#errorCallbacks) cb(error)
  }

  protected async withStatus(callName: string, fn: () => Promise<ErrorRef | void> | void) {
    if (this.status !== 'INITIAL') return
    this.latestMethodCall = callName
    this.status = 'LOADING'
    this.forceEmitUpdate()

    try {
      await fn()

      this.status = 'SUCCESS'
      this.forceEmitUpdate()
    } catch (error: any) {
      this.status = 'ERROR'
      if ('message' in error && 'level' in error && 'error' in error) {
        this.emitError(error)
      }
      this.emitError({
        message: error?.message || 'An unexpected error occurred',
        level: 'major',
        error
      })
      this.forceEmitUpdate()
    }

    this.status = 'INITIAL'
    this.forceEmitUpdate()
  }

  // Prevents memory leaks and storing huge amount of errors
  #trimErrorsIfNeeded() {
    if (this.#errors.length > LIMIT_ON_THE_NUMBER_OF_ERRORS) {
      const excessErrors = this.#errors.length - LIMIT_ON_THE_NUMBER_OF_ERRORS
      this.#errors = this.#errors.slice(excessErrors)
    }
  }

  // returns an unsub function
  onUpdate(cb: (forceUpdate?: boolean) => void, id?: string): () => void {
    if (id) {
      this.#callbacksWithId.push({ id, cb })
    } else {
      this.#callbacks.push(cb)
    }

    return () => {
      if (id) {
        this.#callbacksWithId = this.#callbacksWithId.filter(
          (callbackItem) => callbackItem.id !== id
        )
      } else {
        this.#callbacks.splice(this.#callbacks.indexOf(cb), 1)
      }
    }
  }

  // returns an unsub function for error events
  onError(cb: (error: ErrorRef) => void, id?: string): () => void {
    if (id) {
      this.#errorCallbacksWithId.push({ id, cb })
    } else {
      this.#errorCallbacks.push(cb)
    }

    return () => {
      if (id) {
        this.#errorCallbacksWithId = this.#errorCallbacksWithId.filter(
          (callbackItem) => callbackItem.id !== id
        )
      } else {
        this.#errorCallbacks.splice(this.#errorCallbacks.indexOf(cb), 1)
      }
    }
  }

  toJSON() {
    return {
      ...this,
      emittedErrors: this.emittedErrors // includes the getter in the stringified instance
    }
  }
}
