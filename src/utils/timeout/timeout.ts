// Execute `fn` at a specific interval, ensuring that the current invocation of `fn`
// completes before the next one starts. This serves as an alternative to `setInterval`,
// but providing protection against overlapping invocations of `fn`. It also includes
// debounce logic so that redundant start/restart calls within the same tick are collapsed.

import EventEmitter from '../../controllers/eventEmitter/eventEmitter'

export type RecurringTimeout = {
  start: (options?: { timeout?: number; runImmediately?: boolean }) => void
  restart: (options?: { timeout?: number; runImmediately?: boolean }) => void
  stop: () => void
  updateTimeout: (options: { timeout: number }) => void
  getTimeout: () => number
  getPromise: () => Promise<void> | undefined
  getIsRunning: () => boolean
}

export function createRecurringTimeout(
  fn: () => Promise<void>,
  timeout: number,
  emitError?: EventEmitter['emitError']
): RecurringTimeout {
  let timeoutId: NodeJS.Timeout | undefined
  let running = false
  let debounceFlag = false
  let currentTimeout = timeout
  // NEW: capture latest options within a tick
  let pendingOptions: { timeout?: number; runImmediately?: boolean } | null = null
  let promise: Promise<void> | undefined

  const loop = async () => {
    try {
      promise = fn()
      await promise.finally(() => {
        promise = undefined
      })
    } catch (err: any) {
      console.error('Recurring task error:', err)
      !!emitError && emitError({ error: err, message: 'Recurring task failed', level: 'minor' })
    } finally {
      if (running) {
        timeoutId = setTimeout(loop, currentTimeout)
      }
    }
  }

  const updateTimeout = ({ timeout: newTimeout }: { timeout: number }) => {
    currentTimeout = newTimeout
  }

  const scheduleStart = ({
    timeout: newTimeout,
    runImmediately
  }: {
    timeout?: number
    runImmediately?: boolean
  }) => {
    // Debounce repeated start/restart calls within the same tick
    if (debounceFlag) {
      pendingOptions = {
        ...(pendingOptions || {}),
        timeout: newTimeout ?? pendingOptions?.timeout,
        runImmediately: runImmediately ?? pendingOptions?.runImmediately
      }
      return
    }
    debounceFlag = true
    pendingOptions = { timeout: newTimeout, runImmediately }
    setTimeout(() => {
      debounceFlag = false
      const opts = pendingOptions || {}
      pendingOptions = null

      if (!running) {
        running = true
        if (opts.runImmediately) {
          if (opts.timeout) updateTimeout({ timeout: opts.timeout })
          loop()
        } else {
          if (opts.timeout) updateTimeout({ timeout: opts.timeout })
          timeoutId = setTimeout(loop, currentTimeout)
        }
      }
    }, 0)
  }

  const start = ({
    timeout: newTimeout,
    runImmediately
  }: { timeout?: number; runImmediately?: boolean } = {}) => {
    if (running) return // Already running

    scheduleStart({ timeout: newTimeout, runImmediately })
  }

  const stop = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
    running = false
  }

  const restart = ({
    timeout: newTimeout,
    runImmediately
  }: { timeout?: number; runImmediately?: boolean } = {}) => {
    stop()
    if (newTimeout) updateTimeout({ timeout: newTimeout })
    scheduleStart({ runImmediately })
  }

  return {
    start,
    restart,
    stop,
    updateTimeout,
    getTimeout: () => currentTimeout,
    getPromise: async () => promise,
    getIsRunning: () => running
  }
}
