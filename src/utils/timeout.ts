// Execute `fn` at a specific interval, ensuring that the current invocation of `fn`
// completes before the next one starts. This serves as an alternative to `setInterval`,
// but providing protection against overlapping invocations of `fn`. It also includes
// debounce logic so that redundant start/restart calls within the same tick are collapsed.

export type RecurringTimeout = {
  start: () => void
  restart: () => void
  stop: () => void
}

export function createRecurringTimeout(fn: () => Promise<void>, timeout: number): RecurringTimeout {
  let timeoutId: NodeJS.Timeout | undefined
  let running = false
  let debounceFlag = false

  const loop = async () => {
    try {
      await fn()
    } catch (err) {
      console.error('Recurring task error:', err)
    } finally {
      if (running) {
        timeoutId = setTimeout(loop, timeout)
      }
    }
  }

  const scheduleStart = () => {
    // Debounce repeated start/restart calls within the same tick
    if (debounceFlag) return
    debounceFlag = true
    setTimeout(() => {
      debounceFlag = false
      if (!running) {
        running = true
        timeoutId = setTimeout(loop, timeout)
      }
    }, 0)
  }

  const start = () => {
    if (running) return // Already running
    scheduleStart()
  }

  const stop = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
    running = false
  }

  const restart = () => {
    stop()
    scheduleStart()
  }

  return { start, restart, stop }
}
