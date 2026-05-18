import { describe, expect, test } from '@jest/globals'
import { ZeroAddress } from 'ethers'
import fetch from 'node-fetch'

import { networks } from '../../consts/networks'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { ScamFilter } from './scamFilter'

const network = {
  chainId: 1n,
  platformId: 'ethereum',
  nativeAssetId: 'ethereum'
} as Network
const arbitrum = networks.find((n) => n.chainId === 42161n)
const avalanche = networks.find((n) => n.chainId === 43114n)

if (!arbitrum) throw new Error('unable to find arbitrum network in consts')
if (!avalanche) throw new Error('unable to find avalanche network in consts')

const makeResponse = (body: any, status = 200) =>
  ({
    status,
    json: async () => body
  }) as any

const makeScamFilter = (fetch: Fetch) => new ScamFilter({ fetch, network, timeout: 1 })

describe('ScamFilter', () => {
  test('filters out tokens without a Cena price', async () => {
    const pricedToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const unpricedToken = '0x0000000000000000000000000000000000000001'
    const fetch = jest.fn(async () =>
      makeResponse({
        [pricedToken.toLowerCase()]: { usd: 1 },
        [unpricedToken.toLowerCase()]: { usd: 0 }
      })
    ) as unknown as Fetch

    const scamFilter = makeScamFilter(fetch)

    await expect(
      scamFilter.filterTokensWithoutAPrice([pricedToken, unpricedToken])
    ).resolves.toEqual([pricedToken])
  })

  test('checks native-like tokens through the simple price endpoint', async () => {
    const fetch = jest.fn(async () => makeResponse({ ethereum: { usd: 3000 } })) as unknown as Fetch
    const scamFilter = makeScamFilter(fetch)

    await expect(scamFilter.filterTokensWithoutAPrice([ZeroAddress])).resolves.toEqual([
      ZeroAddress
    ])

    expect(fetch).toHaveBeenCalledWith(
      'https://cena.ambire.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      {}
    )
  })

  test('filters tokens out when Cena cannot confirm a price', async () => {
    const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const fetch = jest.fn(async () => makeResponse({ error: 'failed' })) as unknown as Fetch
    const scamFilter = makeScamFilter(fetch)

    await expect(scamFilter.filterTokensWithoutAPrice([token])).resolves.toEqual([])
  })

  test('filters out the Arbitrum token when Cena does not return a price', async () => {
    const token = '0x385922261d40D72bFF256cB7963cf7223366aF2d'
    const cenaPriceUrl = `https://cena.ambire.com/api/v3/simple/token_price/arbitrum-one?contract_addresses=${token}&vs_currencies=usd`
    const cenaPriceResponse = await fetch(cenaPriceUrl)
    const cenaPriceBody = await cenaPriceResponse.json()
    const cenaTokenPrice = cenaPriceBody[token.toLowerCase()]?.usd

    expect(cenaPriceResponse.status).toBe(200)
    expect(cenaTokenPrice).toBe(0)

    const scamFilter = new ScamFilter({
      fetch: fetch as unknown as Fetch,
      network: arbitrum,
      timeout: 500
    })

    await expect(scamFilter.filterTokensWithoutAPrice([token])).resolves.toEqual([])
  })

  test('filters out the Avalanche token when Cena does not return a price', async () => {
    const token = '0x818ba16dE4b1aF58358cAa2052a4BfD79E104C0f'
    const cenaPriceUrl = `https://cena.ambire.com/api/v3/simple/token_price/avalanche?contract_addresses=${token}&vs_currencies=usd`
    const cenaPriceResponse = await fetch(cenaPriceUrl)
    const cenaPriceBody = await cenaPriceResponse.json()
    const cenaTokenPrice = cenaPriceBody[token.toLowerCase()]?.usd

    expect(cenaPriceResponse.status).toBe(200)
    expect(cenaTokenPrice).toBe(0)

    const scamFilter = new ScamFilter({
      fetch: fetch as unknown as Fetch,
      network: avalanche,
      timeout: 500
    })

    await expect(scamFilter.filterTokensWithoutAPrice([token])).resolves.toEqual([])
  })

  test('keeps the Ethereum token when Cena returns a price', async () => {
    const token = '0x5aFE3855358E112B5647B952709E6165e1c1eEEe'
    const cenaPriceUrl = `https://cena.ambire.com/api/v3/simple/token_price/ethereum?contract_addresses=${token}&vs_currencies=usd`
    const cenaPriceResponse = await fetch(cenaPriceUrl)
    const cenaPriceBody = await cenaPriceResponse.json()
    const cenaTokenPrice = cenaPriceBody[token.toLowerCase()]?.usd

    expect(cenaPriceResponse.status).toBe(200)
    expect(cenaTokenPrice).toBeGreaterThan(0)

    const scamFilter = new ScamFilter({
      fetch: fetch as unknown as Fetch,
      network,
      timeout: 500
    })

    await expect(scamFilter.filterTokensWithoutAPrice([token])).resolves.toEqual([token])
  })
})
