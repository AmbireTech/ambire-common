// Execute `fn` at a specific interval, ensuring that the current invocation of `fn`
// completes before the next one starts. This serves as an alternative to `setInterval`,
// but providing protection against overlapping invocations of `fn`. It also includes
// debounce logic so that redundant start/restart calls within the same tick are collapsed.

import EventEmitter from '../../controllers/eventEmitter/eventEmitter'

export interface IRecurringTimeout {
  start: (options?: { timeout?: number; runImmediately?: boolean }) => void
  restart: (options?: { timeout?: number; runImmediately?: boolean }) => void
  stop: () => void
  updateTimeout: (options: { timeout: number }) => void
  running: boolean
  sessionId: number
  startedRunningAt: number
  currentTimeout: number
  promise: Promise<void> | undefined
}

export class RecurringTimeout implements IRecurringTimeout {
  #id: string | undefined // for debugging

  #timeoutId?: NodeJS.Timeout

  #debounceFlag = false

  #fn: () => Promise<void>

  #pendingOptions: { timeout?: number; runImmediately?: boolean } | null = null

  sessionId: number = 0

  running = false

  startedRunningAt: number = Date.now()

  currentTimeout: number

  promise: Promise<void> | undefined

  #emitError?: EventEmitter['emitError']

  constructor(
    fn: () => Promise<void>,
    timeout: number,
    emitError?: EventEmitter['emitError'],
    id?: string
  ) {
    this.#fn = fn
    this.currentTimeout = timeout
    this.#emitError = emitError
    this.#id = id
  }

  updateTimeout({ timeout }: { timeout: number }) {
    this.currentTimeout = timeout
  }

  start({
    timeout: newTimeout,
    runImmediately
  }: { timeout?: number; runImmediately?: boolean } = {}) {
    if (this.running) return // Already running
    this.#scheduleStart({ timeout: newTimeout, runImmediately })
  }

  stop() {
    if (this.#timeoutId) {
      clearTimeout(this.#timeoutId)
      this.#timeoutId = undefined
    }
    this.running = false
    this.promise = undefined
  }

  restart({
    timeout: newTimeout,
    runImmediately
  }: { timeout?: number; runImmediately?: boolean } = {}) {
    this.stop()
    if (newTimeout) this.updateTimeout({ timeout: newTimeout })
    this.#scheduleStart({ runImmediately })
  }

  #loop() {
    this.promise = this.#fn()
      .catch((err) => {
        console.error('Recurring task error:', err)
        if (this.#emitError)
          this.#emitError({ error: err, message: 'Recurring task failed', level: 'minor' })
      })
      .finally(() => {
        if (this.running) this.#timeoutId = setTimeout(this.#loop.bind(this), this.currentTimeout)
        this.promise = undefined
      })
  }

  #scheduleStart({
    timeout: newTimeout,
    runImmediately
  }: {
    timeout?: number
    runImmediately?: boolean
  }) {
    // Debounce repeated start/restart calls within the same tick
    if (this.#debounceFlag) {
      this.#pendingOptions = {
        ...(this.#pendingOptions || {}),
        timeout: newTimeout ?? this.#pendingOptions?.timeout,
        runImmediately: runImmediately ?? this.#pendingOptions?.runImmediately
      }
      return
    }
    this.#debounceFlag = true
    this.#pendingOptions = { timeout: newTimeout, runImmediately }
    this.sessionId += 1

    setTimeout(() => {
      this.#debounceFlag = false
      const opts = this.#pendingOptions || {}
      this.#pendingOptions = null

      if (!this.running) {
        this.running = true
        this.startedRunningAt = Date.now()
        if (opts.runImmediately) {
          if (opts.timeout) this.updateTimeout({ timeout: opts.timeout })
          this.#loop()
        } else {
          if (opts.timeout) this.updateTimeout({ timeout: opts.timeout })

          this.#timeoutId = setTimeout(() => this.#loop(), this.currentTimeout)
        }
      }
    }, 0)
  }
}
