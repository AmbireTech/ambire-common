import { describe, expect, jest, test } from '@jest/globals'

import { suppressConsole } from '../../test/helpers/console'
import batcher from './batcher'

const URL = 'https://cena.ambire.com/api/v3/simple/price'

const requestGenerator = (queue: any[]) => [{ url: URL, queueSegment: queue }]

const okResponse = (body: any) => ({ status: 200, json: async () => body }) as any

/** A fetch that never settles, so only the batcher's own timeout can end the request */
const hangingFetch = () => new Promise(() => {}) as any

const makeBatcher = (fetchImpl: any, retryTimedOutRequests: boolean) =>
  batcher(fetchImpl, requestGenerator as any, {
    timeoutSettings: { timeoutAfter: 3000, timeoutErrorMessage: 'timed out' },
    retryTimedOutRequests
  })

describe('batcher retry', () => {
  test('a timed out request is not retried by default', async () => {
    const { restore } = suppressConsole()
    jest.useFakeTimers()
    try {
      const fetchImpl = jest.fn(hangingFetch)
      const call = makeBatcher(fetchImpl, false)
      const promise = call({ responseIdentifier: 'eth' })
      const onSettled = jest.fn()
      promise.then(onSettled, onSettled)

      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(3000)

      await expect(promise).rejects.toThrow('request-timeout')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
      restore()
    }
  })

  test('a timed out request is sent once more when the retry is on', async () => {
    const { restore } = suppressConsole()
    jest.useFakeTimers()
    try {
      const fetchImpl = jest.fn(hangingFetch)
      const call = makeBatcher(fetchImpl, true)
      const promise = call({ responseIdentifier: 'eth' })
      const onSettled = jest.fn()
      promise.then(onSettled, onSettled)

      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(3000)

      // The first attempt gave up, but the caller is not rejected yet
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(onSettled).not.toHaveBeenCalled()

      // Only the second timeout ends it - the retry is a single one, not a loop
      await jest.advanceTimersByTimeAsync(3000)
      await expect(promise).rejects.toThrow('request-timeout')
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
      restore()
    }
  })

  test('the retry resolves the batch when the second attempt succeeds', async () => {
    const { restore } = suppressConsole()
    jest.useFakeTimers()
    try {
      const fetchImpl = jest
        .fn<any>()
        .mockImplementationOnce(hangingFetch)
        .mockImplementationOnce(async () => okResponse({ eth: { usd: 4200 } }))
      const call = makeBatcher(fetchImpl, true)
      const promise = call({ responseIdentifier: 'eth' })

      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(3000)

      await expect(promise).resolves.toEqual({ usd: 4200 })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
      restore()
    }
  })

  test('a failure that is not a timeout is passed on without a retry', async () => {
    const { restore } = suppressConsole()
    try {
      const fetchImpl = jest.fn<any>(async () => ({
        status: 400,
        json: async () => ({ error: 'incorrect query' })
      }))
      const call = makeBatcher(fetchImpl, true)

      await expect(call({ responseIdentifier: 'eth' })).rejects.toBeDefined()
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
  })
})
