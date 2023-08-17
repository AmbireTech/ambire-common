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
  private callbacks: (() => void)[] = []

  private errorCallbacks: ((error: ErrorRef) => void)[] = []

  #errors: ErrorRef[] = []

  protected emitUpdate() {
    // eslint-disable-next-line no-restricted-syntax
    for (const cb of this.callbacks) cb()
  }

  protected emitError(error: ErrorRef) {
    this.#errors.push(error)
    this.trimErrorsIfNeeded()

    // eslint-disable-next-line no-restricted-syntax
    for (const cb of this.errorCallbacks) cb(error)
  }

  // Prevents memory leaks and storing huge amount of errors
  private trimErrorsIfNeeded() {
    if (this.#errors.length > LIMIT_ON_THE_NUMBER_OF_ERRORS) {
      const excessErrors = this.#errors.length - LIMIT_ON_THE_NUMBER_OF_ERRORS
      this.#errors = this.#errors.slice(excessErrors)
    }
  }

  public getErrors() {
    return this.#errors
  }

  // returns an unsub function
  onUpdate(cb: () => void): () => void {
    this.callbacks.push(cb)
    return () => this.callbacks.splice(this.callbacks.indexOf(cb), 1)
  }

  // returns an unsub function for error events
  onError(cb: (error: ErrorRef) => void): () => void {
    this.errorCallbacks.push(cb)
    return () => this.errorCallbacks.splice(this.errorCallbacks.indexOf(cb), 1)
  }
}
