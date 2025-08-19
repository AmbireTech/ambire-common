// Execute `fn` at a specific interval, ensuring that the current invocation of `fn`
// completes before the next one starts. This serves as an alternative to `setInterval`,
// but providing protection against overlapping invocations of `fn`. It also includes
// debounce logic so that redundant start/restart calls within the same tick are collapsed.

export type RecurringTimeout = {
  start: (options?: { timeout?: number; runImmediately?: boolean }) => void
  restart: (options?: { timeout?: number; runImmediately?: boolean }) => void
  stop: () => void
  updateTimeout: (options: { timeout: number }) => void
}

export function createRecurringTimeout(fn: () => Promise<void>, timeout: number): RecurringTimeout {
  let timeoutId: NodeJS.Timeout | undefined
  let running = false
  let debounceFlag = false
  let currentTimeout = timeout

  const loop = async () => {
    try {
      await fn()
    } catch (err) {
      console.error('Recurring task error:', err)
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
    if (debounceFlag) return
    debounceFlag = true
    setTimeout(() => {
      debounceFlag = false
      if (!running) {
        running = true
        if (runImmediately) {
          loop()
        } else {
          if (newTimeout) updateTimeout({ timeout: newTimeout })
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

  return { start, restart, stop, updateTimeout }
}
