export const DEFAULT_TIMEOUT_MESSAGE = 'timed out, race timer resolved first'
export const DEFAULT_TIMEOUT_MS = 5000

/**
 * Run an async task with a soft timeout using Promise.race. Notes:
 * - By default, this utility does not cancel the underlying task. If the timeout wins the race,
 *   the returned promise rejects, but the task may continue running in the background.
 * - To also signal cancellation to the underlying operation, pass `{ useAbort: true }`.
 *   In that case, a new `AbortController` is created, its `signal` is provided to the task,
 *   and on timeout the controller is aborted.
 * - Callers may ignore the signal if they don't support cancellation; behavior falls back to soft timeout.
 */
export async function withTimeout<T>(
  task: (args?: { signal?: AbortSignal | null }) => Promise<T>,
  options?: { timeoutMs?: number; message?: string; useAbort?: boolean }
): Promise<T> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    message = DEFAULT_TIMEOUT_MESSAGE,
    useAbort = false
  } = options || {}

  let timer: ReturnType<typeof setTimeout> | undefined
  const controller = useAbort ? new AbortController() : null

  try {
    return await Promise.race<T>([
      task({ signal: controller?.signal ?? null }),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          if (controller) controller.abort()
          reject(new Error(message))
        }, timeoutMs)
      })
    ])
  } catch (err: unknown) {
    const error = err as Error & { name?: string }
    if (error && error.name === 'AbortError') throw new Error(message)
    throw err as Error
  } finally {
    if (timer) clearTimeout(timer)
  }
}
