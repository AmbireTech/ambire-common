import { ZeroAddress } from 'ethers'

import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { PRIVACY_POOLS_CHAINS } from '../../consts/privacyPools'
import { Network } from '../../interfaces/network'
import { getTokenPriceRequests, TokenPricesController } from './tokenPrices'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!
const base = networks.find(({ chainId }) => chainId === 8453n)!

const TOKEN_1 = '0x1111111111111111111111111111111111111111'
const TOKEN_2 = '0x2222222222222222222222222222222222222222'
const TOKEN_3 = '0x3333333333333333333333333333333333333333'
const MINUTE = 60 * 1000

// How the Privacy Pools assets show up in a request: the native one by its coin id
const privacyPoolsAssets = PRIVACY_POOLS_CHAINS['1']!.assets.map(({ address, isNative }) =>
  isNative ? ethereum.nativeAssetId : address.toLowerCase()
)

/** The token addresses (lowercased) and coin ids a price request asked for */
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

describe('TokenPricesController', () => {
  let isEnabled: boolean

  beforeEach(() => {
    isEnabled = true
  })

  const createController = (fetch: any) =>
    new TokenPricesController({ fetch, isTokenPricesEnabled: () => isEnabled })

  describe('what a request carries', () => {
    test('the requested tokens plus the Privacy Pools assets of the network', async () => {
      const { fetch, urls } = createPriceFetch()
      const controller = createController(fetch)

      await controller.getTokenData({
        network: ethereum,
        tokenAddresses: [TOKEN_1, TOKEN_2]
      })

      const requested = getAllRequestedIds(urls)
      expect(requested).toEqual(expect.arrayContaining([TOKEN_1, TOKEN_2, ...privacyPoolsAssets]))
      expect(requested).toHaveLength(2 + privacyPoolsAssets.length)
    })

    test('no Privacy Pools assets that are fresh in the cache, e.g. after an account switch', async () => {
      const { fetch, urls } = createPriceFetch()
      const controller = createController(fetch)

      await controller.getTokenData({ network: ethereum, tokenAddresses: [TOKEN_1] })
      urls.length = 0
      await controller.getTokenData({ network: ethereum, tokenAddresses: [TOKEN_2] })

      // A single request, without the separate coin id one for the native asset
      expect(urls.map(getRequestedIds)).toEqual([[TOKEN_2]])
    })

    test('the Privacy Pools assets again once they were answered more than 5 minutes ago', async () => {
      const { fetch, urls } = createPriceFetch()
      const controller = createController(fetch)

      const now = Date.now()
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now)
      await controller.getTokenData({ network: ethereum, tokenAddresses: [TOKEN_1] })
      dateSpy.mockReturnValue(now + 6 * MINUTE)
      urls.length = 0
      await controller.getTokenData({ network: ethereum, tokenAddresses: [TOKEN_2] })
      dateSpy.mockRestore()

      const requested = getAllRequestedIds(urls)
      expect(requested).toEqual(expect.arrayContaining([TOKEN_2, ...privacyPoolsAssets]))
      expect(requested).toHaveLength(1 + privacyPoolsAssets.length)
    })

    test('no Privacy Pools assets that a request in flight already asks for', async () => {
      const { fetch, urls } = createPriceFetch()
      const controller = createController(fetch)

      await Promise.all([
        controller.getTokenData({ network: ethereum, tokenAddresses: [TOKEN_1] }),
        controller.getTokenData({ network: ethereum, tokenAddresses: [TOKEN_2] })
      ])

      const requestedPerCall = urls.map(getRequestedIds)
      expect(requestedPerCall[requestedPerCall.length - 1]).toEqual([TOKEN_2])
      expect(getAllRequestedIds(urls)).toHaveLength(2 + privacyPoolsAssets.length)
    })

    test('no Privacy Pools assets when the controller is told not to add them', async () => {
      const { fetch, urls } = createPriceFetch()
      const controller = new TokenPricesController({ fetch, addsPrivacyPoolsAssets: false })

      await controller.getTokenData({ network: ethereum, tokenAddresses: [TOKEN_1] })

      expect(getAllRequestedIds(urls)).toEqual([TOKEN_1])
    })

    test('no Privacy Pools assets on the networks they are not on', async () => {
      const { fetch, urls } = createPriceFetch()
      const controller = createController(fetch)

      await controller.getTokenData({ network: base, tokenAddresses: [TOKEN_1] })

      expect(getAllRequestedIds(urls)).toEqual([TOKEN_1])
    })

    test('only the tokens missing from the cache, whoever cached the rest', async () => {
      const { fetch, urls } = createPriceFetch({ price: 2 })
      const controller = createController(fetch)

      // E.g. account A's portfolio
      await controller.getTokenData({
        network: base,
        tokenAddresses: [TOKEN_1, TOKEN_2]
      })
      urls.length = 0
      // E.g. account B's portfolio, which shares TOKEN_1 with account A
      const { tokenData } = await controller.getTokenData({
        network: base,
        tokenAddresses: [TOKEN_1, TOKEN_3]
      })

      expect(getAllRequestedIds(urls)).toEqual([TOKEN_3])
      expect(tokenData.get(TOKEN_1)?.priceIn).toEqual([{ baseCurrency: 'usd', price: 2 }])
      expect(tokenData.get(TOKEN_3)?.priceIn).toEqual([{ baseCurrency: 'usd', price: 2 }])
    })

    test("never the tokens of another call, even if they're requested at the same time", async () => {
      const { fetch, urls } = createPriceFetch()
      const controller = createController(fetch)

      await Promise.all([
        controller.getTokenData({ network: base, tokenAddresses: [TOKEN_1] }),
        controller.getTokenData({ network: base, tokenAddresses: [TOKEN_2] })
      ])

      expect(urls.map(getRequestedIds)).toEqual([[TOKEN_1], [TOKEN_2]])
    })
  })

  describe('cache', () => {
    test('answers from the cache without a request when every token was answered recently', async () => {
      const { fetch } = createPriceFetch()
      const controller = createController(fetch)
      const params = { network: base, tokenAddresses: [TOKEN_1, TOKEN_2] }

      await controller.getTokenData(params)
      const { tokenData } = await controller.getTokenData(params)

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(tokenData.size).toBe(2)
    })

    test('counts a recent "no price" answer as cached and leaves the token out', async () => {
      const { fetch } = createPriceFetch({ unpriced: [TOKEN_2] })
      const controller = createController(fetch)
      const params = { network: base, tokenAddresses: [TOKEN_1, TOKEN_2] }

      await controller.getTokenData(params)
      const { tokenData, error } = await controller.getTokenData(params)

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(error).toBeNull()
      expect(tokenData.has(TOKEN_1)).toBe(true)
      expect(tokenData.has(TOKEN_2)).toBe(false)
    })

    test('asks again for the tokens answered more than 5 minutes ago', async () => {
      const { fetch, urls } = createPriceFetch({ unpriced: [TOKEN_2] })
      const controller = createController(fetch)
      const params = { network: base, tokenAddresses: [TOKEN_1, TOKEN_2] }

      const now = Date.now()
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now)
      await controller.getTokenData(params)
      dateSpy.mockReturnValue(now + 6 * MINUTE)
      urls.length = 0
      await controller.getTokenData(params)
      dateSpy.mockRestore()

      expect(getAllRequestedIds(urls)).toEqual([TOKEN_1, TOKEN_2])
    })

    test('finds a cached token regardless of the address casing', async () => {
      const { fetch } = createPriceFetch()
      const controller = createController(fetch)

      await controller.getTokenData({ network: base, tokenAddresses: [TOKEN_1] })
      const checksummedLike = TOKEN_1.toUpperCase().replace('0X', '0x')
      const { tokenData } = await controller.getTokenData({
        network: base,
        tokenAddresses: [checksummedLike]
      })

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(tokenData.has(TOKEN_1)).toBe(true)
    })
  })

  describe('opting out of token prices', () => {
    test('sends nothing and returns nothing', async () => {
      const { fetch } = createPriceFetch()
      const controller = createController(fetch)
      isEnabled = false

      const { tokenData, error } = await controller.getTokenData({
        network: base,
        tokenAddresses: [TOKEN_1]
      })

      expect(fetch).not.toHaveBeenCalled()
      expect(tokenData.size).toBe(0)
      expect(error).toBeNull()
    })

    test('drops the prices cached before the user opted out', async () => {
      const { fetch } = createPriceFetch()
      const controller = createController(fetch)
      await controller.getTokenData({ network: base, tokenAddresses: [TOKEN_1] })

      isEnabled = false
      await controller.getTokenData({ network: base, tokenAddresses: [TOKEN_1] })

      // Turned back on, the price is requested again instead of read from the old cache
      isEnabled = true
      await controller.getTokenData({ network: base, tokenAddresses: [TOKEN_1] })

      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('failures', () => {
    test('falls back to cached prices younger than an hour and returns the error', async () => {
      const working = createPriceFetch({ price: 3 })
      const controller = createController(working.fetch)
      const params = {
        network: base,
        tokenAddresses: [TOKEN_1]
      }

      const now = Date.now()
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now)
      await controller.getTokenData(params)

      working.fetch.mockImplementation(async () => {
        throw new Error('cena is down')
      })
      dateSpy.mockReturnValue(now + 10 * MINUTE)
      const { tokenData, error } = await controller.getTokenData(params)

      dateSpy.mockReturnValue(now + 2 * 60 * MINUTE)
      const tooOld = await controller.getTokenData(params)
      dateSpy.mockRestore()

      expect(error?.message).toBe('cena is down')
      expect(tokenData.get(TOKEN_1)?.priceIn).toEqual([{ baseCurrency: 'usd', price: 3 }])
      expect(tooOld.error?.message).toBe('cena is down')
      expect(tooOld.tokenData.size).toBe(0)
    })

    test('returns the cached prices of the other tokens along with the error', async () => {
      const working = createPriceFetch({ price: 3 })
      const controller = createController(working.fetch)
      await controller.getTokenData({ network: base, tokenAddresses: [TOKEN_1] })
      working.fetch.mockImplementation(async () => {
        throw new Error('cena is down')
      })

      const { tokenData, error } = await controller.getTokenData({
        network: base,
        tokenAddresses: [TOKEN_1, TOKEN_2]
      })

      expect(error?.message).toBe('cena is down')
      expect(tokenData.has(TOKEN_1)).toBe(true)
      expect(tokenData.has(TOKEN_2)).toBe(false)
    })

    test('names the network when the request times out', async () => {
      const hangingFetch = jest.fn(() => new Promise(() => {}))
      const controller = new TokenPricesController({ fetch: hangingFetch as any, timeoutMs: 10 })

      const { error } = await controller.getTokenData({
        network: base,
        tokenAddresses: [TOKEN_1]
      })

      expect(error?.message).toBe(`Cena request timed out on ${base.name}`)
    })

    test('times out when the response arrives but its body never finishes', async () => {
      const stallingFetch = jest.fn(async () => ({
        status: 200,
        json: () => new Promise(() => {})
      }))
      const controller = new TokenPricesController({ fetch: stallingFetch as any, timeoutMs: 10 })

      const { error } = await controller.getTokenData({
        network: base,
        tokenAddresses: [TOKEN_1]
      })

      expect(error?.message).toBe(`Cena request timed out on ${base.name}`)
    })

    test('gives the error of a request it waited for to the waiting call too', async () => {
      let rejectRequest: (error: Error) => void = () => {}
      const fetch = jest.fn(
        () =>
          new Promise((_, reject) => {
            rejectRequest = reject
          })
      )
      const controller = createController(fetch)
      const params = { network: base, tokenAddresses: [TOKEN_1] }

      const first = controller.getTokenData(params)
      const second = controller.getTokenData(params)
      rejectRequest(new Error('cena is down'))

      expect((await first).error?.message).toBe('cena is down')
      expect((await second).error?.message).toBe('cena is down')
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('concurrent calls', () => {
    test('wait for a request in flight that asks for their tokens instead of sending another', async () => {
      const { fetch } = createPriceFetch({ price: 4 })
      const controller = createController(fetch)
      const params = { network: base, tokenAddresses: [TOKEN_1] }

      const [first, second] = await Promise.all([
        controller.getTokenData(params),
        controller.getTokenData(params)
      ])

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(first.tokenData.get(TOKEN_1)?.priceIn).toEqual([{ baseCurrency: 'usd', price: 4 }])
      expect(second.tokenData.get(TOKEN_1)?.priceIn).toEqual([{ baseCurrency: 'usd', price: 4 }])
    })

    test('request only their tokens that no request in flight asks for', async () => {
      const { fetch, urls } = createPriceFetch()
      const controller = createController(fetch)

      await Promise.all([
        controller.getTokenData({ network: base, tokenAddresses: [TOKEN_1] }),
        controller.getTokenData({
          network: base,
          tokenAddresses: [TOKEN_1, TOKEN_2]
        })
      ])

      expect(urls.map(getRequestedIds)).toEqual([[TOKEN_1], [TOKEN_2]])
    })

    test('a Privacy Pools lookup waits for a request that carries the assets as cover', async () => {
      const { fetch } = createPriceFetch()
      const controller = createController(fetch)
      const privacyPoolsAssetAddresses = PRIVACY_POOLS_CHAINS['1']!.assets.map(
        ({ address }) => address
      )

      await Promise.all([
        controller.getTokenData({ network: ethereum, tokenAddresses: [TOKEN_1] }),
        controller.getTokenData({
          network: ethereum,
          tokenAddresses: privacyPoolsAssetAddresses
        })
      ])

      // One request for the coin id (native) assets and one for the contract tokens
      expect(fetch.mock.calls.length).toBe(
        getTokenPriceRequests(ethereum, [TOKEN_1, ...privacyPoolsAssetAddresses], 'usd').length
      )
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

    test('looks an aliased token up by coin id even when its address is lowercased', () => {
      const lowercasedStkAave = '0x4da27a545c0c5b758a6ba100e3a049001de870f5'

      expect(getTokenPriceRequests(ethereum, [lowercasedStkAave], 'usd')).toEqual([
        {
          url: 'https://cena.ambire.com/api/v3/simple/price?ids=aave&vs_currencies=usd',
          tokenAddresses: [lowercasedStkAave]
        }
      ])
    })

    test('splits contract tokens into pages of 40', () => {
      const tokens = Array.from(
        { length: 41 },
        (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`
      )

      const requests = getTokenPriceRequests(base, tokens, 'usd')

      expect(requests).toHaveLength(2)
      expect(requests[0]!.tokenAddresses).toHaveLength(40)
      expect(requests[1]!.tokenAddresses).toHaveLength(1)
    })

    test('requests no contract tokens on a network without a CoinGecko platform', () => {
      const networkWithoutPlatform: Network = { ...base, platformId: '' }

      expect(getTokenPriceRequests(networkWithoutPlatform, [TOKEN_1], 'usd')).toEqual([])
    })
  })
})
