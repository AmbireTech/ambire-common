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
  #callbacks: {
    id: string | null
    cb: () => void
  }[] = []

  #errorCallbacks: {
    id: string | null
    cb: (error: ErrorRef) => void
  }[] = []

  #errors: ErrorRef[] = []

  get onUpdateIds() {
    return this.#callbacks.map((item) => item.id)
  }

  get onErrorIds() {
    return this.#errorCallbacks.map((item) => item.id)
  }

  protected emitUpdate() {
    // eslint-disable-next-line no-restricted-syntax
    for (const i of this.#callbacks) i.cb()
  }

  protected emitError(error: ErrorRef) {
    this.#errors.push(error)
    this.#trimErrorsIfNeeded()

    // eslint-disable-next-line no-restricted-syntax
    for (const i of this.#errorCallbacks) i.cb(error)
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
    const callbackId = id || new Date().getTime().toString()
    this.#callbacks.push({
      id: callbackId,
      cb
    })

    return () => {
      this.#callbacks = this.#callbacks.filter((callbackItem) => callbackItem.id !== callbackId)
    }
  }

  // returns an unsub function for error events
  onError(cb: (error: ErrorRef) => void, id?: string): () => void {
    const callbackId = id || new Date().getTime().toString()

    this.#errorCallbacks.push({
      id: callbackId,
      cb
    })

    return () => {
      this.#errorCallbacks = this.#errorCallbacks.filter(
        (callbackItem) => callbackItem.id !== callbackId
      )
    }
  }
}
