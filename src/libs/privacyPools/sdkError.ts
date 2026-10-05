/**
 * Turns whatever the Privacy Pools SDK threw into an `Error`, keeping its message and the original
 * as `cause`. The SDK's Redux Toolkit thunks rethrow plain `{ name, message, stack }` objects.
 */
export const toPrivacyPoolsSdkError = (error: unknown, fallbackMessage: string): Error => {
  if (error instanceof Error) return error

  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? (error as { message: unknown }).message
      : undefined
  if (typeof message !== 'string' || !message) return new Error(fallbackMessage, { cause: error })

  const normalized = new Error(message, { cause: error })
  const { name, stack } = error as { name?: unknown; stack?: unknown }
  if (typeof name === 'string' && name) normalized.name = name
  if (typeof stack === 'string' && stack) normalized.stack = stack

  return normalized
}
