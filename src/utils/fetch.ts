const fetchWithTimeout = async (
  fetch: Function,
  url: string,
  options: RequestInit,
  timeout: number
): Promise<any> => {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    // The race is kept as the backstop, for a `fetch` that ignores the signal. The abort is
    // what frees the socket the abandoned request would otherwise keep holding - and that
    // matters, because our RPCs share one host whose few connections everything else queues on.
    return await Promise.race([
      fetch(url, { ...options, signal: controller.signal }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          // Rejected before the abort, as a fetch that honours the signal rejects as soon as it
          // is aborted and would otherwise win the race with its own AbortError
          reject(new Error('request-timeout'))
          controller.abort()
        }, timeout)
      })
    ])
  } finally {
    clearTimeout(timeoutId)
  }
}

export { fetchWithTimeout }
