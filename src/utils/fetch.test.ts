import { describe, expect, jest, test } from '@jest/globals'

import { fetchWithTimeout } from './fetch'

const URL = 'https://cena.ambire.com/api/v3/simple/price'

describe('fetchWithTimeout', () => {
  test('passes an abort signal to the fetch it makes', async () => {
    const fetchImpl = jest.fn<any>(async () => 'response')

    await expect(fetchWithTimeout(fetchImpl, URL, {}, 3000)).resolves.toBe('response')

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal!.aborted).toBe(false)
  })

  test('keeps the caller options and only adds the signal', async () => {
    const fetchImpl = jest.fn<any>(async () => 'response')
    const headers = { 'x-app-env': 'prod' }

    await fetchWithTimeout(fetchImpl, URL, { method: 'POST', headers }, 3000)

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toBe(headers)
  })

  test('aborts the request it gives up on, so it stops holding a connection', async () => {
    jest.useFakeTimers()
    try {
      let capturedSignal: AbortSignal | undefined
      const fetchImpl = jest.fn<any>((_url: string, init: RequestInit) => {
        capturedSignal = init.signal as AbortSignal
        // Never settles on its own, the way a request stuck behind a busy socket would not
        return new Promise(() => {})
      })

      const promise = fetchWithTimeout(fetchImpl, URL, {}, 3000)
      const assertion = expect(promise).rejects.toThrow('request-timeout')

      expect(capturedSignal!.aborted).toBe(false)
      await jest.advanceTimersByTimeAsync(3000)
      await assertion

      expect(capturedSignal!.aborted).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  test('clears its timer once the request is done, instead of leaving it pending', async () => {
    jest.useFakeTimers()
    try {
      const before = jest.getTimerCount()

      await fetchWithTimeout(
        jest.fn<any>(async () => 'response'),
        URL,
        {},
        3000
      )

      expect(jest.getTimerCount()).toBe(before)
    } finally {
      jest.useRealTimers()
    }
  })

  test('a fetch that fails on its own is passed on untouched', async () => {
    const failure = new Error('network down')
    const fetchImpl = jest.fn<any>(async () => {
      throw failure
    })

    await expect(fetchWithTimeout(fetchImpl, URL, {}, 3000)).rejects.toBe(failure)
  })
})
