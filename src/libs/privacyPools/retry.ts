/** Attempts per request before it gives up. */
const MAX_ATTEMPTS = 4

/** Doubles per attempt. Covers a rate limit or a dropped connection, not a refused query. */
const BASE_BACKOFF_MS = 500

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Runs a network request again after a growing pause when it fails. Throws the last error once
 * every attempt failed.
 */
export const retryPrivacyPoolsRequest = async <Result>(
  request: () => Promise<Result>
): Promise<Result> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await request()
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw error

      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1))
    }
  }
}
