// Execute `fn` at a specific interval, ensuring that the current invocation of `fn`
// completes before the next one starts. This serves as an alternative to `setInterval`,
// but providing protection against overlapping invocations of `fn`. It also includes
// debounce logic so that redundant start/restart calls within the same tick are collapsed.

import EventEmitter from '../../controllers/eventEmitter/eventEmitter'

type RecurringTimeoutStartOptions = {
  timeout?: number
  /**
   * Whether to run the function immediately upon starting,
   * instead of waiting for the first timeout interval.
   */
  runImmediately?: boolean
  /**
   * Whether to allow the starting of a new function execution
   * even if the previous one is still running. There will still
   * be only one interval scheduled at a time.
   *
   * @example
   * - Execution 1 starts
   * - Execution 2 starts while Execution 1 is still running
   * - Execution 1 completes - a new execution is not scheduled. Simply
   * the promise of Execution 1 is resolved.
   * - Execution 2 completes - a new execution is scheduled.
   */
  allowOverlap?: boolean
}

export interface IRecurringTimeout {
  start: (options?: RecurringTimeoutStartOptions) => void
  restart: (options?: RecurringTimeoutStartOptions) => void
  stop: () => void
  updateTimeout: (options: { timeout: number }) => void
  running: boolean
  sessionId: number
  fnExecutionsCount: number
  startedRunningAt: number
  currentTimeout: number
  promise: Promise<void> | undefined
  startScheduled: boolean
}

export class RecurringTimeout implements IRecurringTimeout {
  #id: string | undefined // for debugging

  #timeoutId?: NodeJS.Timeout

  #emitError?: EventEmitter['emitError']

  #fn: () => Promise<void>

  // used mainly for testing how many times the fn was called
  sessionId: number = 0

  fnExecutionsCount: number = 0

  running = false

  startedRunningAt: number = 0

  currentTimeout: number

  promise: Promise<void> | undefined

  startScheduled = false

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

  start(opts: RecurringTimeoutStartOptions = {}) {
    this.#scheduleStart(opts)
  }

  stop() {
    this.startScheduled = false
    this.#reset()
  }

  restart(opts: RecurringTimeoutStartOptions = {}) {
    this.#reset()
    this.#scheduleStart(opts)
  }

  async #loop() {
    this.fnExecutionsCount += 1
    const currentCount = this.fnExecutionsCount

    try {
      this.promise = this.#fn()
      await this.promise
    } catch (err: any) {
      if (!this.promise) return
      console.error('Recurring task error:', err)
      if (this.#emitError)
        this.#emitError({ error: err, message: 'Recurring task failed', level: 'minor' })
    } finally {
      // If fnExecutionsCount has changed, it means `restart` was called during the execution of fn,
      // so we shouldn't schedule the next loop here.
      if (this.promise && this.fnExecutionsCount === currentCount) {
        if (this.running) this.#timeoutId = setTimeout(this.#loop.bind(this), this.currentTimeout)
        this.promise = undefined
      }
    }
  }

  #scheduleStart(opts: RecurringTimeoutStartOptions = {}) {
    if (this.running) return

    if (this.startScheduled) return
    this.startScheduled = true

    queueMicrotask(() => {
      this.startScheduled = false
      const { timeout: newTimeout, runImmediately, allowOverlap } = opts

      this.running = true
      this.startedRunningAt = Date.now()
      this.sessionId += 1

      if (newTimeout) this.updateTimeout({ timeout: newTimeout })

      // Prevents starting a new loop if the previous one is still running
      if (this.promise && !allowOverlap) return

      if (runImmediately) {
        this.#loop()
      } else {
        this.#timeoutId = setTimeout(this.#loop.bind(this), this.currentTimeout)
      }
    })
  }

  #reset() {
    this.running = false
    this.startedRunningAt = 0

    if (this.#timeoutId) {
      clearTimeout(this.#timeoutId)
      this.#timeoutId = undefined
    }
  }
}
