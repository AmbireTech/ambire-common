import { ZeroAddress } from 'ethers'

import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { PRIVACY_POOLS_CHAINS } from '../../consts/privacyPools'
import { Network } from '../../interfaces/network'
import { getTokenPriceRequests, TokenPricesService } from './tokenPrices'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!
const base = networks.find(({ chainId }) => chainId === 8453n)!

const ACCOUNT_A = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa'
const ACCOUNT_B = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
const TOKEN_1 = '0x1111111111111111111111111111111111111111'
const TOKEN_2 = '0x2222222222222222222222222222222222222222'
const TOKEN_3 = '0x3333333333333333333333333333333333333333'
const BASE_TOKEN = '0x4444444444444444444444444444444444444444'
const MINUTE = 60 * 1000

// How the Privacy Pools assets show up in a request: the native one by its coin id
const privacyPoolsAssets = PRIVACY_POOLS_CHAINS['1']!.assets.map(({ address, isNative }) =>
  isNative ? ethereum.nativeAssetId : address.toLowerCase()
)

/** The token addresses (lowercased) and coin ids every price request asked for */
const getRequestedIds = (url: string): string[] => {
  const { searchParams } = new URL(url)
  const ids = searchParams.get('contract_addresses') || searchParams.get('ids') || ''
  return ids.split(',').map((id) => id.toLowerCase())
}

/**
 * A mocked fetch that prices every requested token or coin id at `price`, except the ones in
 * `unpriced`, and records the urls it was called with.
 */
const createPriceFetch = ({
  price = 1,
  unpriced = [] as string[],
  fail = false
}: { price?: number; unpriced?: string[]; fail?: boolean } = {}) => {
  const urls: string[] = []
  const fetch = jest.fn(async (url: any) => {
    urls.push(url)
    if (fail) throw new Error('cena is down')

    const body = Object.fromEntries(
      getRequestedIds(url)
        .filter((id) => !unpriced.includes(id))
        .map((id) => [id, { usd: price }])
    )

    return { status: 200, json: async () => body } as any
  })

  return { fetch, urls }
}

const getAllRequestedIds = (urls: string[]) => urls.flatMap(getRequestedIds)

describe('TokenPricesService', () => {
  let isEnabled: boolean

  beforeEach(() => {
    isEnabled = true
  })

  const createService = (fetch: any) =>
    new TokenPricesService({ fetch, isTokenPricesEnabled: () => isEnabled })

  describe('what a request carries', () => {
    test("sends the account's tokens of every feature plus the Privacy Pools assets", async () => {
      const { fetch, urls } = createPriceFetch()
      const service = createService(fetch)

      await service.getTokenData({
        network: ethereum,
        accountAddr: ACCOUNT_A,
        source: 'portfolio',
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      })
      urls.length = 0

      await service.getTokenData({
        network: ethereum,
        accountAddr: ACCOUNT_A,
        source: 'defi',
        tokenAddresses: [TOKEN_2],
        maxAgeMs: 5 * MINUTE
      })

      const requested = getAllRequestedIds(urls)
      expect(requested).toEqual(expect.arrayContaining([TOKEN_1, TOKEN_2, ...privacyPoolsAssets]))
    })

    test('adds the Privacy Pools assets only on the networks they exist on', async () => {
      const { fetch, urls } = createPriceFetch()
      const service = createService(fetch)

      await service.getTokenData({
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio',
        tokenAddresses: [BASE_TOKEN],
        maxAgeMs: 5 * MINUTE
      })

      expect(getAllRequestedIds(urls)).toEqual([BASE_TOKEN])
    })

    test('never sends the tokens of two accounts in one request', async () => {
      const { fetch, urls } = createPriceFetch()
      const service = createService(fetch)

      await service.getTokenData({
        network: ethereum,
        accountAddr: ACCOUNT_A,
        source: 'portfolio',
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      })
      urls.length = 0

      await service.getTokenData({
        network: ethereum,
        accountAddr: ACCOUNT_B,
        source: 'portfolio',
        tokenAddresses: [TOKEN_2],
        maxAgeMs: 5 * MINUTE
      })

      const requested = getAllRequestedIds(urls)
      expect(requested).toContain(TOKEN_2)
      expect(requested).not.toContain(TOKEN_1)
    })

    test('a lookup without an account sends only the requested tokens and the Privacy Pools assets', async () => {
      const { fetch, urls } = createPriceFetch()
      const service = createService(fetch)

      await service.getTokenData({
        network: ethereum,
        accountAddr: ACCOUNT_A,
        source: 'portfolio',
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      })
      urls.length = 0

      await service.getTokenData({
        network: ethereum,
        tokenAddresses: [TOKEN_2],
        maxAgeMs: 5 * MINUTE
      })

      const requested = getAllRequestedIds(urls)
      expect(requested).toEqual(expect.arrayContaining([TOKEN_2, ...privacyPoolsAssets]))
      expect(requested).not.toContain(TOKEN_1)
    })

    test("replaces a feature's token list instead of adding to it", async () => {
      const { fetch, urls } = createPriceFetch()
      const service = createService(fetch)

      await service.getTokenData({
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio',
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      })
      urls.length = 0

      await service.getTokenData({
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio',
        tokenAddresses: [TOKEN_2],
        maxAgeMs: 5 * MINUTE
      })

      expect(getAllRequestedIds(urls)).toEqual([TOKEN_2])
    })

    test('a token looked up without a feature is not remembered for the next request', async () => {
      const { fetch, urls } = createPriceFetch()
      const service = createService(fetch)

      await service.getTokenData({
        network: base,
        accountAddr: ACCOUNT_A,
        tokenAddresses: [TOKEN_3],
        maxAgeMs: 5 * MINUTE
      })
      urls.length = 0

      await service.getTokenData({
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio',
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      })

      expect(getAllRequestedIds(urls)).toEqual([TOKEN_1])
    })
  })

  describe('cache', () => {
    test('answers from the cache without a request when every price is fresh', async () => {
      const { fetch } = createPriceFetch({ price: 2 })
      const service = createService(fetch)
      const params = {
        network: ethereum,
        accountAddr: ACCOUNT_A,
        source: 'portfolio' as const,
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      }

      await service.getTokenData(params)
      const { tokenData } = await service.getTokenData(params)

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(tokenData.get(TOKEN_1)?.priceIn).toEqual([{ baseCurrency: 'usd', price: 2 }])
    })

    test('shares cached prices between accounts', async () => {
      const { fetch } = createPriceFetch()
      const service = createService(fetch)

      await service.getTokenData({
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio',
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      })
      const { tokenData } = await service.getTokenData({
        network: base,
        accountAddr: ACCOUNT_B,
        source: 'portfolio',
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      })

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(tokenData.has(TOKEN_1)).toBe(true)
    })

    test('requests the whole list again when one price is missing', async () => {
      const { fetch, urls } = createPriceFetch()
      const service = createService(fetch)

      await service.getTokenData({
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio',
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      })
      urls.length = 0

      await service.getTokenData({
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'defi',
        tokenAddresses: [TOKEN_2],
        maxAgeMs: 5 * MINUTE
      })

      expect(getAllRequestedIds(urls)).toEqual([TOKEN_1, TOKEN_2])
    })

    test('requests prices older than maxAgeMs again', async () => {
      const { fetch } = createPriceFetch()
      const service = createService(fetch)
      const params = {
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio' as const,
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      }

      const now = Date.now()
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now)
      await service.getTokenData(params)
      dateSpy.mockReturnValue(now + 6 * MINUTE)
      await service.getTokenData(params)
      dateSpy.mockRestore()

      expect(fetch).toHaveBeenCalledTimes(2)
    })

    test('ignoreCache requests prices that are cached and fresh', async () => {
      const { fetch } = createPriceFetch()
      const service = createService(fetch)
      const params = {
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'defi' as const,
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      }

      await service.getTokenData(params)
      await service.getTokenData({ ...params, ignoreCache: true })

      expect(fetch).toHaveBeenCalledTimes(2)
    })

    test('leaves out tokens the price API has no price for', async () => {
      const { fetch } = createPriceFetch({ unpriced: [TOKEN_2] })
      const service = createService(fetch)

      const { tokenData, error } = await service.getTokenData({
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio',
        tokenAddresses: [TOKEN_1, TOKEN_2],
        maxAgeMs: 5 * MINUTE
      })

      expect(error).toBeNull()
      expect(tokenData.has(TOKEN_1)).toBe(true)
      expect(tokenData.has(TOKEN_2)).toBe(false)
    })

    test('counts a recent "no price" answer as cached instead of requesting it on every call', async () => {
      const { fetch } = createPriceFetch({ unpriced: [TOKEN_2] })
      const service = createService(fetch)
      const params = {
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio' as const,
        tokenAddresses: [TOKEN_1, TOKEN_2],
        maxAgeMs: 5 * MINUTE
      }

      await service.getTokenData(params)
      const { tokenData } = await service.getTokenData(params)

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(tokenData.has(TOKEN_1)).toBe(true)
      expect(tokenData.has(TOKEN_2)).toBe(false)
    })

    test('requests the whole list again once a "no price" answer is older than maxAgeMs', async () => {
      const { fetch, urls } = createPriceFetch({ unpriced: [TOKEN_2] })
      const service = createService(fetch)
      const params = {
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio' as const,
        tokenAddresses: [TOKEN_1, TOKEN_2],
        maxAgeMs: 5 * MINUTE
      }

      const now = Date.now()
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now)
      await service.getTokenData(params)
      dateSpy.mockReturnValue(now + 6 * MINUTE)
      urls.length = 0
      await service.getTokenData(params)
      dateSpy.mockRestore()

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(getAllRequestedIds(urls)).toEqual([TOKEN_1, TOKEN_2])
    })

    test('getCachedTokenData reads what setTokenData stored', () => {
      const service = createService(createPriceFetch().fetch)
      const tokenData = { priceIn: [{ baseCurrency: 'usd', price: 12 }], marketDataIn: [] }

      service.setTokenData(1n, [[TOKEN_1, tokenData]])

      expect(service.getCachedTokenData(1n, TOKEN_1, 5 * MINUTE)).toEqual(tokenData)
      expect(service.getCachedTokenData(8453n, TOKEN_1, 5 * MINUTE)).toBeNull()
    })
  })

  describe('opt-out', () => {
    test('sends nothing and returns nothing while token prices are turned off', async () => {
      const { fetch } = createPriceFetch()
      const service = createService(fetch)
      isEnabled = false

      const { tokenData } = await service.getTokenData({
        network: ethereum,
        accountAddr: ACCOUNT_A,
        source: 'portfolio',
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      })

      expect(fetch).not.toHaveBeenCalled()
      expect(tokenData.size).toBe(0)
    })

    test('drops prices cached before the user opted out', async () => {
      const { fetch } = createPriceFetch()
      const service = createService(fetch)
      const params = {
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio' as const,
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      }

      await service.getTokenData(params)
      isEnabled = false
      expect(service.getCachedTokenData(8453n, TOKEN_1, 5 * MINUTE)).toBeNull()

      isEnabled = true
      await service.getTokenData(params)
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    test('ignores token data set while token prices are turned off', () => {
      const service = createService(createPriceFetch().fetch)
      isEnabled = false
      service.setTokenData(1n, [
        [TOKEN_1, { priceIn: [{ baseCurrency: 'usd', price: 1 }], marketDataIn: [] }]
      ])
      isEnabled = true

      expect(service.getCachedTokenData(1n, TOKEN_1, 5 * MINUTE)).toBeNull()
    })
  })

  describe('failures', () => {
    test('falls back to cached prices younger than maxAgeOnFailureMs and returns the error', async () => {
      const working = createPriceFetch({ price: 3 })
      const service = createService(working.fetch)
      const params = {
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio' as const,
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE,
        maxAgeOnFailureMs: 60 * MINUTE
      }

      const now = Date.now()
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now)
      await service.getTokenData(params)

      working.fetch.mockImplementation(async () => {
        throw new Error('cena is down')
      })
      dateSpy.mockReturnValue(now + 10 * MINUTE)
      const { tokenData, error } = await service.getTokenData(params)

      dateSpy.mockReturnValue(now + 2 * 60 * MINUTE)
      const tooOld = await service.getTokenData(params)
      dateSpy.mockRestore()

      expect(error?.message).toBe('cena is down')
      expect(tokenData.get(TOKEN_1)?.priceIn).toEqual([{ baseCurrency: 'usd', price: 3 }])
      expect(tooOld.error).not.toBeNull()
      expect(tooOld.tokenData.size).toBe(0)
    })

    test('names the network when the request times out', async () => {
      const fetch = jest.fn(() => new Promise(() => {}))
      const service = new TokenPricesService({ fetch: fetch as any, timeoutMs: 10 })

      const { error } = await service.getTokenData({
        network: base,
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      })

      expect(error?.message).toBe(`Cena request timed out on ${base.name}`)
    })
  })

  describe('concurrent calls', () => {
    test("share the account's request in flight instead of sending another", async () => {
      const { fetch } = createPriceFetch()
      const service = createService(fetch)
      const params = {
        network: base,
        accountAddr: ACCOUNT_A,
        source: 'portfolio' as const,
        tokenAddresses: [TOKEN_1],
        maxAgeMs: 5 * MINUTE
      }

      const [first, second] = await Promise.all([
        service.getTokenData(params),
        service.getTokenData(params)
      ])

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(first.tokenData.has(TOKEN_1)).toBe(true)
      expect(second.tokenData.has(TOKEN_1)).toBe(true)
    })

    test('a call waiting on a request for other tokens sends its own afterwards', async () => {
      const { fetch, urls } = createPriceFetch()
      const service = createService(fetch)

      await Promise.all([
        service.getTokenData({
          network: base,
          accountAddr: ACCOUNT_A,
          source: 'portfolio',
          tokenAddresses: [TOKEN_1],
          maxAgeMs: 5 * MINUTE
        }),
        service.getTokenData({
          network: base,
          accountAddr: ACCOUNT_A,
          source: 'defi',
          tokenAddresses: [TOKEN_2],
          maxAgeMs: 5 * MINUTE
        })
      ])

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(getRequestedIds(urls[1]!)).toEqual([TOKEN_1, TOKEN_2])
    })
  })

  describe('getTokenPriceRequests', () => {
    test('looks native tokens up by coin id and joins ids with a literal comma', () => {
      const requests = getTokenPriceRequests(ethereum, [ZeroAddress, TOKEN_1, TOKEN_2], 'usd')

      expect(requests.map(({ url }) => url)).toEqual([
        'https://cena.ambire.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
        `https://cena.ambire.com/api/v3/simple/token_price/ethereum?contract_addresses=${TOKEN_1},${TOKEN_2}&vs_currencies=usd`
      ])
    })

    test('splits contract tokens into pages of 40', () => {
      const tokens = Array.from(
        { length: 41 },
        (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`
      )

      const requests = getTokenPriceRequests(ethereum, tokens, 'usd')

      expect(requests.map(({ tokenAddresses }) => tokenAddresses.length)).toEqual([40, 1])
    })

    test('requests no contract tokens on a network without a CoinGecko platform', () => {
      const networkWithoutPlatform: Network = { ...base, platformId: '' }

      expect(getTokenPriceRequests(networkWithoutPlatform, [TOKEN_1], 'usd')).toEqual([])
    })
  })
})
