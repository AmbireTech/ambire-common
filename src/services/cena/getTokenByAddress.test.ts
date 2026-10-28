import { getAddress } from 'ethers'

import { describe, expect, it, jest } from '@jest/globals'

import { getTokenByAddress } from './getTokenByAddress'

const tokenAddress = '0x1111111111111111111111111111111111111111'

const makeResponse = (body: any, ok = true, status = ok ? 200 : 400) => ({
  ok,
  status,
  json: async () => body
})

describe('getTokenByAddress', () => {
  it('returns the Cena metadata of a token', async () => {
    const fetch = (jest.fn() as any)
      .mockResolvedValueOnce(makeResponse({ platformId: 'ethereum' }))
      .mockResolvedValueOnce(
        makeResponse({
          decimals: { ethereum: 18 },
          image: { small: 'https://cena.ambire.com/custom.png' },
          name: 'Custom token',
          platforms: { ethereum: tokenAddress },
          symbol: 'custom'
        })
      )

    await expect(getTokenByAddress({ fetch, address: tokenAddress, chainId: 1 })).resolves.toEqual({
      address: getAddress(tokenAddress),
      chainId: 1,
      decimals: 18,
      icon: 'https://cena.ambire.com/custom.png',
      name: 'Custom token',
      symbol: 'custom'
    })
    expect(fetch.mock.calls.map(([url]: [string]) => url)).toEqual([
      'https://cena.ambire.com/api/v3/platform/1',
      `https://cena.ambire.com/api/v3/coins/ethereum/contract/${getAddress(tokenAddress)}`
    ])
  })

  it('does not call Cena for an invalid address', async () => {
    const fetch = jest.fn()

    await expect(
      getTokenByAddress({ fetch: fetch as any, address: 'not-an-address', chainId: 1 })
    ).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns null when Cena does not know the network', async () => {
    const fetch = (jest.fn() as any).mockResolvedValueOnce(makeResponse({}, false, 404))

    await expect(
      getTokenByAddress({ fetch, address: tokenAddress, chainId: 1 })
    ).resolves.toBeNull()
  })

  it('returns null when Cena does not know the token', async () => {
    const fetch = (jest.fn() as any)
      .mockResolvedValueOnce(makeResponse({ platformId: 'ethereum' }))
      .mockResolvedValueOnce(makeResponse({}, false, 404))

    await expect(
      getTokenByAddress({ fetch, address: tokenAddress, chainId: 1 })
    ).resolves.toBeNull()
  })

  it('does not trust Cena metadata for a different contract', async () => {
    const fetch = (jest.fn() as any)
      .mockResolvedValueOnce(makeResponse({ platformId: 'ethereum' }))
      .mockResolvedValueOnce(
        makeResponse({
          decimals: { ethereum: 18 },
          name: 'Wrong token',
          platforms: { ethereum: '0x2222222222222222222222222222222222222222' },
          symbol: 'wrong'
        })
      )

    await expect(
      getTokenByAddress({ fetch, address: tokenAddress, chainId: 1 })
    ).resolves.toBeNull()
  })

  it.each([
    ['blacklisted', { blacklist: true }],
    ['removed', { removed: true }],
    ['without decimals', { decimals: {} }],
    ['with out of range decimals', { decimals: { ethereum: 300 } }],
    ['without a symbol', { symbol: '' }]
  ])('rejects a token %s', async (_, override) => {
    const fetch = (jest.fn() as any)
      .mockResolvedValueOnce(makeResponse({ platformId: 'ethereum' }))
      .mockResolvedValueOnce(
        makeResponse({
          decimals: { ethereum: 18 },
          name: 'Custom token',
          platforms: { ethereum: tokenAddress },
          symbol: 'custom',
          ...override
        })
      )

    await expect(
      getTokenByAddress({ fetch, address: tokenAddress, chainId: 1 })
    ).resolves.toBeNull()
  })

  it('throws when Cena responds with an error', async () => {
    const fetch = (jest.fn() as any).mockResolvedValueOnce(makeResponse({}, false, 500))

    await expect(getTokenByAddress({ fetch, address: tokenAddress, chainId: 1 })).rejects.toThrow(
      'Unable to retrieve token information by address'
    )
  })

  it('throws when Cena cannot be reached', async () => {
    const fetch = (jest.fn() as any).mockRejectedValueOnce(new Error('network down'))

    await expect(getTokenByAddress({ fetch, address: tokenAddress, chainId: 1 })).rejects.toThrow(
      'network down'
    )
  })

  it('gives up on a Cena request that takes too long and aborts it', async () => {
    jest.useFakeTimers()

    try {
      let capturedSignal: AbortSignal | undefined
      const fetch = jest.fn((_url: string, init: any) => {
        capturedSignal = init.signal
        // Never settles on its own
        return new Promise(() => {})
      })

      const tokenPromise = getTokenByAddress({
        fetch: fetch as any,
        address: tokenAddress,
        chainId: 1
      })
      const assertion = expect(tokenPromise).rejects.toThrow(
        'temporarily unavailable or your internet connection is too slow'
      )

      await jest.advanceTimersByTimeAsync(15000)
      await assertion
      expect(capturedSignal?.aborted).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not abort a Cena request that finished in time', async () => {
    let capturedSignal: AbortSignal | undefined
    const fetch = jest.fn((_url: string, init: any) => {
      capturedSignal = init.signal
      return Promise.resolve(makeResponse({}, false, 404))
    })

    await getTokenByAddress({ fetch: fetch as any, address: tokenAddress, chainId: 1 })

    expect(capturedSignal?.aborted).toBe(false)
  })
})
