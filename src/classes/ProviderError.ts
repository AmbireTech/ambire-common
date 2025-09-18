const INVICTUS_ERROR_PREFIX = 'Invictus RPC error'
const INVICTUS_200_ERROR_PREFIX = 'Invictus RPC error (2XX)'

export class ProviderError extends Error {
  isProviderInvictus?: boolean

  statusCode?: number

  code?: string

  constructor({
    originalError,
    providerUrl
  }: {
    originalError: Error & { [key: string]: any }
    providerUrl?: string
  }) {
    super('')
    // Copy all properties from the original error to this error
    Object.assign(this, originalError)
    const statusCode = originalError?.response?.statusCode

    const isProviderInvictus = providerUrl?.includes('invictus')
    let message = originalError.message

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

    this.name = 'ProviderError'
    this.message = message
    if (isProviderInvictus !== undefined) this.isProviderInvictus = isProviderInvictus
    if (statusCode !== undefined) this.statusCode = statusCode
  }
}
