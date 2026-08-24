import { Network } from 'ethers'

import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { FetchJsonRpcProvider } from './fetchJsonRpcProvider'

const RPC_URL = 'https://rpc.test.ambire.com/ethereum'
const MAINNET = Network.from(1)

type FetchCall = [string, RequestInit]

/** A `fetch` that answers with what the test tells it to, and records the calls. */
function mockFetch(
  answer: (body: any, callIndex: number) => { status?: number; body: string; headers?: any }
) {
  const calls: FetchCall[] = []
  const fetchMock = jest.fn(async (url: any, request: any) => {
    calls.push([url, request])

    const { status = 200, body, headers = {} } = answer(JSON.parse(request.body), calls.length - 1)

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: { forEach: (fn: any) => Object.entries(headers).forEach(([k, v]) => fn(v, k)) },
      text: async () => body
    }
  })

  global.fetch = fetchMock as any

  return { calls, fetchMock }
}

/** A result for every payload in the request, so the caller can match them up. */
const answerAll = (body: any) => {
  const payloads = Array.isArray(body) ? body : [body]

  return {
    body: JSON.stringify(
      payloads.map(({ id, method }) => ({ jsonrpc: '2.0', id, result: `answer:${method}` }))
    )
  }
}

const newProvider = (options?: any) =>
  new FetchJsonRpcProvider(RPC_URL, MAINNET, { staticNetwork: MAINNET, ...options })

const realFetch = global.fetch

afterEach(() => {
  global.fetch = realFetch
  jest.useRealTimers()
})

describe('FetchJsonRpcProvider: the request it sends', () => {
  test('posts the payload as JSON and hands back the response in an array', async () => {
    const { calls } = mockFetch(answerAll)
    const provider = newProvider()

    try {
      expect(await provider.send('eth_blockNumber', [])).toBe('answer:eth_blockNumber')

      const [url, request] = calls[0]!

      expect(url).toBe(RPC_URL)
      expect(request.method).toBe('POST')
      expect((request.headers as any)['content-type']).toBe('application/json')
      expect(typeof request.body).toBe('string')
      expect(JSON.parse(request.body as string)).toMatchObject({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: []
      })
    } finally {
      provider.destroy()
    }
  })

  test('sends the headers the connection carries, credentials included', async () => {
    const { calls } = mockFetch(answerAll)
    const provider = newProvider()

    try {
      const connection = provider._getConnection()
      connection.setHeader('x-api-key', 'secret')
      provider._getConnection = () => connection

      await provider.send('eth_blockNumber', [])

      expect((calls[0]![1].headers as any)['x-api-key']).toBe('secret')
    } finally {
      provider.destroy()
    }
  })
})

describe('FetchJsonRpcProvider: batching', () => {
  test('sends concurrent calls as one batched request and matches the results back', async () => {
    const { calls } = mockFetch(answerAll)
    const provider = newProvider()

    try {
      const [first, second, third] = await Promise.all([
        provider.send('eth_blockNumber', []),
        provider.send('eth_gasPrice', []),
        provider.send('eth_chainId', [])
      ])

      // One request for all three, which is the whole point of ethers' batching
      expect(calls).toHaveLength(1)

      const sent = JSON.parse(calls[0]![1].body as string)

      expect(Array.isArray(sent)).toBe(true)
      expect(sent.map((p: any) => p.method)).toEqual([
        'eth_blockNumber',
        'eth_gasPrice',
        'eth_chainId'
      ])
      // Matched by id rather than by position
      expect([first, second, third]).toEqual([
        'answer:eth_blockNumber',
        'answer:eth_gasPrice',
        'answer:eth_chainId'
      ])
    } finally {
      provider.destroy()
    }
  })

  test('matches results back even when the RPC answers them out of order', async () => {
    mockFetch((body) => {
      const payloads = Array.isArray(body) ? body : [body]

      return {
        body: JSON.stringify(
          payloads
            .map(({ id, method }) => ({ jsonrpc: '2.0', id, result: `answer:${method}` }))
            .reverse()
        )
      }
    })
    const provider = newProvider()

    try {
      expect(
        await Promise.all([provider.send('eth_blockNumber', []), provider.send('eth_gasPrice', [])])
      ).toEqual(['answer:eth_blockNumber', 'answer:eth_gasPrice'])
    } finally {
      provider.destroy()
    }
  })

  test('keeps the per-RPC batch limit, which some providers reject a request without', async () => {
    const { calls } = mockFetch(answerAll)
    const provider = newProvider({ batchMaxCount: 2 })

    try {
      await Promise.all([
        provider.send('eth_blockNumber', []),
        provider.send('eth_gasPrice', []),
        provider.send('eth_chainId', [])
      ])

      expect(calls).toHaveLength(2)
      expect(JSON.parse(calls[0]![1].body as string)).toHaveLength(2)
      // ethers sends a batch that came down to one payload as a lone object
      expect(JSON.parse(calls[1]![1].body as string)).toMatchObject({ method: 'eth_chainId' })
    } finally {
      provider.destroy()
    }
  })

  test('sends a single call unbatched when batching is off', async () => {
    const { calls } = mockFetch(answerAll)
    const provider = newProvider({ batchMaxCount: 1 })

    try {
      await Promise.all([provider.send('eth_blockNumber', []), provider.send('eth_gasPrice', [])])

      expect(calls).toHaveLength(2)
      expect(Array.isArray(JSON.parse(calls[0]![1].body as string))).toBe(false)
    } finally {
      provider.destroy()
    }
  })
})

describe('FetchJsonRpcProvider: errors', () => {
  test('reports an HTTP failure with the status the app reads off it', async () => {
    mockFetch(() => ({ status: 500, body: 'upstream exploded' }))
    const provider = newProvider()

    try {
      const error: any = await provider.send('eth_blockNumber', []).catch((e) => e)

      expect(error.code).toBe('SERVER_ERROR')
      // What `ProviderError` reads, and what the RPC health checks act on
      expect(error.response.statusCode).toBe(500)
      expect(error.info.responseBody).toBe('upstream exploded')
      expect(error.info.responseStatus).toBe('500 Error')
    } finally {
      provider.destroy()
    }
  })

  test('reports a body that is not JSON as such, with the body kept', async () => {
    mockFetch(() => ({ body: '<html>rate limited by the proxy</html>' }))
    const provider = newProvider()

    try {
      const error: any = await provider.send('eth_blockNumber', []).catch((e) => e)

      expect(error.code).toBe('UNSUPPORTED_OPERATION')
      expect(error.message).toContain('response body is not valid JSON')
      expect(error.info.response.bodyText).toBe('<html>rate limited by the proxy</html>')
    } finally {
      provider.destroy()
    }
  })

  test('still maps a JSON-RPC error the way ethers maps it', async () => {
    // Proves the error handling above `_send` is untouched: a reverted `eth_call`
    // has to keep arriving as a CALL_EXCEPTION with its revert data
    const revertData = '0x08c379a0'
    mockFetch((body) => ({
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: 3, message: 'execution reverted', data: revertData }
      })
    }))
    const provider = newProvider()

    try {
      const error: any = await provider
        .send('eth_call', [{ to: `0x${'11'.repeat(20)}`, data: '0x1234' }, 'latest'])
        .catch((e) => e)

      expect(error.code).toBe('CALL_EXCEPTION')
      expect(error.data).toBe(revertData)
    } finally {
      provider.destroy()
    }
  })
})

describe('FetchJsonRpcProvider: timeout', () => {
  test('reports a request that outlives the connection timeout as a timeout', async () => {
    jest.useFakeTimers()
    const abortErrors: any[] = []
    global.fetch = jest.fn(
      (_url: any, request: any) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener('abort', () => {
            const error = new Error('Aborted')
            error.name = 'AbortError'
            abortErrors.push(error)
            reject(error)
          })
        })
    ) as any
    const provider = newProvider()

    try {
      const sent = provider.send('eth_blockNumber', []).catch((error) => error)

      await jest.advanceTimersByTimeAsync(300_000 + 1000)

      const error: any = await sent

      expect(error.code).toBe('TIMEOUT')
      // The request itself was cancelled, not just abandoned
      expect(abortErrors).toHaveLength(1)
    } finally {
      provider.destroy()
    }
  })

  test('clears the timeout of a request that answered, leaving no timer behind', async () => {
    jest.useFakeTimers()
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')
    mockFetch(answerAll)
    const provider = newProvider()

    try {
      const sent = provider.send('eth_blockNumber', [])

      await jest.advanceTimersByTimeAsync(100)
      await sent

      expect(clearTimeoutSpy).toHaveBeenCalled()
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      clearTimeoutSpy.mockRestore()
      provider.destroy()
    }
  })
})
