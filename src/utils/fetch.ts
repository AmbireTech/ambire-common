const fetchWithTimeout = async (
  fetch: Function,
  url: string,
  options: RequestInit,
  timeout: number
): Promise<any> => {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('request-timeout'))
    }, timeout)
  })

  return Promise.race([fetch(url, options), timeoutPromise])
}

export { fetchWithTimeout }
