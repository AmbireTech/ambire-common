const fetchWithTimeout = async (
  fetch: Function,
  url: string,
  options: RequestInit,
  timeout: number
): Promise<Response> => {
  return new Promise((resolve, reject) => {
    fetch(url, options).then(resolve).catch(reject)
    setTimeout(() => reject(new Error('request-timeout')), timeout)
  })
}

export { fetchWithTimeout }
