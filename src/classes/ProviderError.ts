export class ProviderError extends Error {
  isProviderInvictus?: boolean

  providerUrl?: string

  statusCode?: number

  code?: string

  constructor({
    originalError,
    providerUrl
  }: {
    originalError: Error & { [key: string]: any }
    providerUrl?: string
  }) {
    super(originalError.message)
    // Copy all properties from the original error to this error
    Object.assign(this, originalError)
    const statusCode = originalError?.response?.statusCode
    const isProviderInvictus = providerUrl?.includes('invictus')

    this.name = 'ProviderError'
    this.providerUrl = providerUrl
    this.isProviderInvictus = isProviderInvictus
    this.statusCode = statusCode
  }
}
