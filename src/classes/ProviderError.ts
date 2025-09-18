const INVICTUS_ERROR_PREFIX = 'Invictus RPC error'
const INVICTUS_200_ERROR_PREFIX = 'Invictus RPC error (2XX)'

export class ProviderError extends Error {
  isProviderInvictus?: boolean

  statusCode?: number

  code?: string

  constructor({
    message: _message,
    statusCode,
    code,
    providerUrl
  }: {
    message: string
    statusCode?: number
    code?: string
    providerUrl?: string
  }) {
    const isProviderInvictus =
      providerUrl?.includes('invictus') || providerUrl?.includes('localhost')
    let message = _message

    if (
      isProviderInvictus &&
      typeof message === 'string' &&
      !message.startsWith(INVICTUS_ERROR_PREFIX) &&
      !message.startsWith(INVICTUS_200_ERROR_PREFIX)
    ) {
      // Ethers doesn't return a status code for 2XX responses, so we treat undefined as 2XX
      // and have handling just in case statusCode is explicitly set to 200-299
      const is200Status = !statusCode || (statusCode >= 200 && statusCode < 300)
      message = `${is200Status ? INVICTUS_200_ERROR_PREFIX : INVICTUS_ERROR_PREFIX} ${
        providerUrl ? `(${providerUrl})` : ''
      }: ${message}`
    }

    super(message)
    this.name = 'ProviderError'
    if (isProviderInvictus !== undefined) this.isProviderInvictus = isProviderInvictus
    if (statusCode !== undefined) this.statusCode = statusCode
    if (code !== undefined) this.code = code
  }
}
