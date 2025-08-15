// Execute `fn` at a specific interval, ensuring that the current invocation of `fn`
// completes before the next one starts. This serves as an alternative to `setInterval`,
// but providing protection against overlapping invocations of `fn`.
export function createRecurringTimeout(
  fn: () => Promise<void>,
  timeout: number
): { start: () => void; stop: () => void } {
  let timeoutId: NodeJS.Timeout | undefined
  let running = false

  const stop = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
    running = false
  }

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

  const start = () => {
    if (running) return // Prevent multiple overlapping loops
    running = true
    timeoutId = setTimeout(loop, timeout)
  }

  return { start, stop }
}
