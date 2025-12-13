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

  // collapse multiple start/restart calls in the same tick
  #pendingStart?: { timeout?: number; runImmediately?: boolean }

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

  start(opts: { timeout?: number; runImmediately?: boolean } = {}) {
    this.#scheduleStart(opts)
  }

  stop() {
    this.startScheduled = false
    this.#reset()
  }

  restart(opts: { timeout?: number; runImmediately?: boolean } = {}) {
    this.#reset()
    this.#scheduleStart(opts)
  }

  async #loop() {
    try {
      this.promise = this.#fn()
      this.fnExecutionsCount += 1
      await this.promise
    } catch (err: any) {
      if (!this.promise) {
        console.error('Reccuring task error but no promise', err)

        return
      }
      console.error('Recurring task error:', err)
      if (this.#emitError)
        this.#emitError({ error: err, message: 'Recurring task failed', level: 'minor' })
    } finally {
      if (this.promise) {
        if (this.running) this.#timeoutId = setTimeout(this.#loop.bind(this), this.currentTimeout)
        this.promise = undefined
      }
    }
  }

  #scheduleStart(
    opts: {
      timeout?: number
      runImmediately?: boolean
    } = {}
  ) {
    if (this.running) return
    this.#pendingStart = opts // collect latest opts for this tick
    if (this.startScheduled) return
    this.startScheduled = true

    queueMicrotask(() => {
      this.startScheduled = false
      const { timeout: newTimeout, runImmediately } = this.#pendingStart || {}
      this.#pendingStart = undefined

      this.running = true
      this.startedRunningAt = Date.now()
      this.sessionId += 1

      if (newTimeout) this.updateTimeout({ timeout: newTimeout })

      if (this.promise) return // prevents multiple executions in one tick

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
