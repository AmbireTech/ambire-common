import { describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { TokenPricesService } from '../../services/tokenPrices/tokenPrices'
import { TokenDataCacheValue } from '../portfolio/interfaces'
import { updatePositionsByProviderAssetPrices } from './defiPrices'
import { AssetType, PositionAsset, PositionsByProvider } from './types'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!
const ACCOUNT = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const AAVE_TOKEN = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'

const asset = (address: string, overrides: Partial<PositionAsset> = {}): PositionAsset => ({
  address,
  symbol: 'TKN',
  name: 'Token',
  decimals: 18,
  amount: 10n ** 18n,
  iconUrl: '',
  type: AssetType.Liquidity,
  ...overrides
})

const provider = (
  providerName: string,
  assets: PositionAsset[],
  positionInUSD?: number
): PositionsByProvider => ({
  providerName,
  chainId: 1n,
  iconUrl: '',
  siteUrl: '',
  source: 'custom',
  type: 'common',
  positions: [
    {
      id: `${providerName}-position`,
      assets,
      additionalData: { positionInUSD }
    }
  ]
})

/** A token prices service that prices every requested token at `price` */
const createTokenPrices = (price = 2, error: Error | null = null) => {
  const getTokenData = jest.fn(async ({ tokenAddresses }: { tokenAddresses: string[] }) => ({
    tokenData: new Map<string, TokenDataCacheValue>(
      error
        ? []
        : tokenAddresses.map((address) => [
            address.toLowerCase(),
            { priceIn: [{ baseCurrency: 'usd', price }], marketDataIn: [] }
          ])
    ),
    error
  }))

  return { tokenPrices: { getTokenData } as unknown as TokenPricesService, getTokenData }
}

describe('updatePositionsByProviderAssetPrices', () => {
  test('passes an empty DeFi token list when every asset already has a price', async () => {
    const { tokenPrices, getTokenData } = createTokenPrices()
    const positionsByProvider = [
      provider('Uniswap V3', [asset(WETH, { priceIn: { baseCurrency: 'usd', price: 3000 } })])
    ]

    const result = await updatePositionsByProviderAssetPrices(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      positionsByProvider
    })

    expect(getTokenData).toHaveBeenCalledTimes(1)
    expect(getTokenData).toHaveBeenCalledWith(
      expect.objectContaining({ accountAddr: ACCOUNT, source: 'defi', tokenAddresses: [] })
    )
    expect(result.positionsByProvider).toEqual(positionsByProvider)
  })

  test("stops sending a closed position's tokens with the account's other price requests", async () => {
    const urls: string[] = []
    const fetch = jest.fn(async (url: any) => {
      urls.push(url)
      const ids = new URL(url).searchParams.get('contract_addresses')?.split(',') || []
      return {
        status: 200,
        json: async () => Object.fromEntries(ids.map((id) => [id, { usd: 1 }]))
      } as any
    })
    const tokenPrices = new TokenPricesService({ fetch })
    const requestedContracts = () =>
      urls.flatMap(
        (url) => new URL(url).searchParams.get('contract_addresses')?.split(',') || []
      )

    // An open position with an unpriced asset puts it on the account's DeFi token list
    await updatePositionsByProviderAssetPrices(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      positionsByProvider: [provider('Uniswap V3', [asset(USDC)])]
    })
    expect(requestedContracts()).toContain(USDC.toLowerCase())

    // The position is closed: the DeFi token list is emptied without sending a request
    urls.length = 0
    await updatePositionsByProviderAssetPrices(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      positionsByProvider: []
    })
    expect(urls).toHaveLength(0)

    // So the account's next request no longer carries it
    await tokenPrices.getTokenData({
      network: ethereum,
      accountAddr: ACCOUNT,
      source: 'portfolio',
      tokenAddresses: [WETH],
      maxAgeMs: 5 * 60 * 1000,
      ignoreCache: true
    })
    expect(requestedContracts()).toContain(WETH.toLowerCase())
    expect(requestedContracts()).not.toContain(USDC.toLowerCase())
  })

  test('prices only the assets without a price and keeps the prices Debank set', async () => {
    const { tokenPrices, getTokenData } = createTokenPrices(2)
    const debankPrice = { baseCurrency: 'usd', price: 3000 }

    const { positionsByProvider, error } = await updatePositionsByProviderAssetPrices(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      positionsByProvider: [
        provider('Uniswap V3', [asset(WETH, { priceIn: debankPrice, value: 3000 }), asset(USDC)])
      ]
    })

    expect(error).toBeNull()
    expect(getTokenData).toHaveBeenCalledWith(
      expect.objectContaining({ accountAddr: ACCOUNT, source: 'defi', tokenAddresses: [USDC] })
    )
    const [weth, usdc] = positionsByProvider[0]!.positions[0]!.assets
    expect(weth!.priceIn).toEqual(debankPrice)
    expect(usdc!.priceIn).toEqual({ baseCurrency: 'usd', price: 2 })
    expect(usdc!.value).toBe(2)
    // Without a value from Debank, the position's value is the sum of its assets
    expect(positionsByProvider[0]!.positions[0]!.additionalData.positionInUSD).toBe(3002)
  })

  test("keeps a position's value that is already set", async () => {
    const { tokenPrices } = createTokenPrices(2)

    const { positionsByProvider } = await updatePositionsByProviderAssetPrices(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      positionsByProvider: [provider('Uniswap V3', [asset(USDC)], 50)]
    })

    expect(positionsByProvider[0]!.positions[0]!.additionalData.positionInUSD).toBe(50)
  })

  test('never sends the tokens of Aave positions, which the Aave oracle prices', async () => {
    const { tokenPrices, getTokenData } = createTokenPrices()

    const { positionsByProvider } = await updatePositionsByProviderAssetPrices(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      positionsByProvider: [provider('AAVE v3', [asset(AAVE_TOKEN)]), provider('Uniswap V3', [asset(USDC)])]
    })

    expect(getTokenData).toHaveBeenCalledTimes(1)
    expect(getTokenData.mock.calls[0]![0].tokenAddresses).toEqual([USDC])
    expect(positionsByProvider[0]!.positions[0]!.assets[0]!.priceIn).toBeUndefined()
  })

  test('returns the error and leaves the assets unpriced when the prices cannot be fetched', async () => {
    const { tokenPrices } = createTokenPrices(2, new Error('cena is down'))

    const { positionsByProvider, error } = await updatePositionsByProviderAssetPrices(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      positionsByProvider: [provider('Uniswap V3', [asset(USDC)])]
    })

    expect(error?.message).toBe('cena is down')
    expect(positionsByProvider[0]!.positions[0]!.assets[0]!.priceIn).toBeUndefined()
  })
})
