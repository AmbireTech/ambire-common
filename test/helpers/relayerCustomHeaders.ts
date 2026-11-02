/**
 * Turns the `RELAYER_CUSTOM_HEADERS` env value, a JSON object of header names and values,
 * into a headers object. An empty value gives no headers. The error never contains the
 * value, because it can be a secret.
 */
const parseRelayerCustomHeaders = (value?: string): Record<string, string> => {
  if (!value) return {}

  let headers: unknown
  try {
    headers = JSON.parse(value)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new Error('RELAYER_CUSTOM_HEADERS must be a JSON object with string values')
  }

  const isObject = typeof headers === 'object' && headers !== null && !Array.isArray(headers)
  if (!isObject || !Object.values(headers).every((header) => typeof header === 'string')) {
    throw new Error('RELAYER_CUSTOM_HEADERS must be a JSON object with string values')
  }

  return headers as Record<string, string>
}

/**
 * Wraps a fetch so that the requests to the relayer carry the custom headers. Any other
 * url, like a look-alike host, gets nothing extra. The headers are applied last, so a
 * caller can not overwrite them.
 */
const createFetchWithRelayerCustomHeaders = (
  baseFetch: typeof fetch,
  headers: Record<string, string>,
  relayerUrl: string
): typeof fetch => {
  const relayerOrigin = new URL(relayerUrl).origin

  return (input, init) => {
    const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href
    const isRelayerUrl = url === relayerOrigin || url.startsWith(`${relayerOrigin}/`)
    if (!isRelayerUrl) return baseFetch(input, init)

    const requestHeaders = new Headers(
      init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined)
    )
    Object.entries(headers).forEach(([name, value]) => requestHeaders.set(name, value))

    return baseFetch(input, { ...init, headers: requestHeaders })
  }
}

export { createFetchWithRelayerCustomHeaders, parseRelayerCustomHeaders }
