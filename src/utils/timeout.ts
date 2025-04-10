// Execute `fn` at a specific interval, ensuring that the current invocation of `fn`
// completes before the next one starts. This serves as an alternative to `setInterval`,
// but providing protection against overlapping invocations of `fn`.
export function createRecurringTimeout(
  fn: () => Promise<void>,
  timeout: number
): { start: () => void; stop: () => void } {
  let timeoutId: NodeJS.Timeout | undefined

  const stop = () => {
    clearTimeout(timeoutId)
    timeoutId = undefined
  }

  const start = () => {
    if (timeoutId) stop()

    timeoutId = setTimeout(async () => {
      await fn()
      start()
    }, timeout)
  }

  return {
    start,
    stop
  }
}
