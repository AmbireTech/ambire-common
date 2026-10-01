import { jest } from '@jest/globals'

import { Fetch } from '../../src/interfaces/fetch'

type HeldResponse = { resolve: () => void; promise: Promise<void> }

const createHeldResponse = (): HeldResponse => {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((res) => {
    resolve = res
  })

  return { resolve, promise }
}

/**
 * A stand-in for the function selectors API that knows the signatures in `apiSignatures`, keyed
 * by selector. Every request is recorded with the selector prefixes it asked for. With
 * `holdResponses` each response waits until its entry in `heldResponses` is resolved, and the
 * first `failingAttempts` requests reject like a network failure.
 */
const makeSelectorsApi = (
  apiSignatures: Record<string, string[]>,
  {
    holdResponses = false,
    failingAttempts = 0
  }: { holdResponses?: boolean; failingAttempts?: number } = {}
) => {
  const requests: { prefixes: string[] }[] = []
  const heldResponses: HeldResponse[] = []
  let attempts = 0

  const fetch = jest.fn(async (url: string) => {
    const prefixes = new URL(url).searchParams.get('selectors')!.split(',')
    requests.push({ prefixes })
    attempts += 1
    console.log(`[selectors api] request #${attempts} for ${prefixes.join(',')}`)

    if (attempts <= failingAttempts) throw new Error('Network error')

    if (holdResponses) {
      const heldResponse = createHeldResponse()
      heldResponses.push(heldResponse)
      await heldResponse.promise
    }

    const data = Object.fromEntries(
      Object.entries(apiSignatures).filter(([selector]) =>
        prefixes.some((prefix) => selector.startsWith(prefix))
      )
    )

    return { json: async () => ({ success: true, data }) }
  })

  // Only `json` is read from the response, so the stand-in passes for a real fetch
  return { fetch: fetch as unknown as Fetch & typeof fetch, requests, heldResponses }
}

/**
 * Polls until `condition` holds, and throws with `description` when it doesn't within `timeoutMs`.
 */
const waitUntil = async (condition: () => boolean, description: string, timeoutMs = 2000) => {
  const startedAt = Date.now()
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs)
      throw new Error(`Timed out waiting until ${description}`)

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
  }
}

export { makeSelectorsApi, waitUntil }
