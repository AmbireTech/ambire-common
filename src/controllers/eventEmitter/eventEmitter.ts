/* eslint-disable no-restricted-syntax */
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
    cb: () => void
  }[] = []

  #callbacks: (() => void)[] = []

  #errorCallbacksWithId: {
    id: string | null
    cb: (error: ErrorRef) => void
  }[] = []

  #errorCallbacks: ((error: ErrorRef) => void)[] = []

  #errors: ErrorRef[] = []

  get onUpdateIds() {
    return this.#callbacksWithId.map((item) => item.id)
  }

  get onErrorIds() {
    return this.#errorCallbacksWithId.map((item) => item.id)
  }

  protected emitUpdate() {
    // eslint-disable-next-line no-restricted-syntax
    for (const i of this.#callbacksWithId) i.cb()
    // eslint-disable-next-line no-restricted-syntax
    for (const cb of this.#callbacks) cb()
  }

  protected emitError(error: ErrorRef) {
    this.#errors.push(error)
    this.#trimErrorsIfNeeded()

    // eslint-disable-next-line no-restricted-syntax
    for (const i of this.#errorCallbacksWithId) i.cb(error)
    // eslint-disable-next-line no-restricted-syntax
    for (const cb of this.#errorCallbacks) cb(error)
  }

  // Prevents memory leaks and storing huge amount of errors
  #trimErrorsIfNeeded() {
    if (this.#errors.length > LIMIT_ON_THE_NUMBER_OF_ERRORS) {
      const excessErrors = this.#errors.length - LIMIT_ON_THE_NUMBER_OF_ERRORS
      this.#errors = this.#errors.slice(excessErrors)
    }
  }

  getErrors() {
    return this.#errors
  }

  // returns an unsub function
  onUpdate(cb: () => void, id?: string): () => void {
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
}
