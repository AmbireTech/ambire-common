import { describe, expect, jest, test } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import { networks } from '../../consts/networks'
import { ITokenPricesController } from '../../interfaces/tokenPrices'
import { TokenDataCacheValue } from '../portfolio/interfaces'
import { priceCustomProviderPositions } from './defiPositions'
import { updatePositionsByProviderAssetPrices } from './defiPrices'
import { AssetType, DeFiPositionsError, PositionAsset, PositionsByProvider } from './types'

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

  return { tokenPrices: { getTokenData } as unknown as ITokenPricesController, getTokenData }
}

describe('updatePositionsByProviderAssetPrices', () => {
  test('asks for nothing when every asset already has a price', async () => {
    const { tokenPrices, getTokenData } = createTokenPrices()
    const positionsByProvider = [
      provider('Uniswap V3', [asset(WETH, { priceIn: { baseCurrency: 'usd', price: 3000 } })])
    ]

    const result = await updatePositionsByProviderAssetPrices(tokenPrices, {
      network: ethereum,
      positionsByProvider
    })

    expect(getTokenData).not.toHaveBeenCalled()
    expect(result.positionsByProvider).toBe(positionsByProvider)
  })

  test('prices only the assets without a price and keeps the prices Debank set', async () => {
    const { tokenPrices, getTokenData } = createTokenPrices(2)
    const debankPrice = { baseCurrency: 'usd', price: 3000 }

    const { positionsByProvider, error } = await updatePositionsByProviderAssetPrices(tokenPrices, {
      network: ethereum,
      positionsByProvider: [
        provider('Uniswap V3', [asset(WETH, { priceIn: debankPrice, value: 3000 }), asset(USDC)])
      ]
    })

    expect(error).toBeNull()
    expect(getTokenData).toHaveBeenCalledWith(
      expect.objectContaining({ tokenAddresses: [USDC] })
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
      positionsByProvider: [provider('Uniswap V3', [asset(USDC)], 50)]
    })

    expect(positionsByProvider[0]!.positions[0]!.additionalData.positionInUSD).toBe(50)
  })

  test('never sends the tokens of Aave positions, which the Aave oracle prices', async () => {
    const { tokenPrices, getTokenData } = createTokenPrices()

    const { positionsByProvider } = await updatePositionsByProviderAssetPrices(tokenPrices, {
      network: ethereum,
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
      positionsByProvider: [provider('Uniswap V3', [asset(USDC)])]
    })

    expect(error?.message).toBe('cena is down')
    expect(positionsByProvider[0]!.positions[0]!.assets[0]!.priceIn).toBeUndefined()
  })
})

describe('priceCustomProviderPositions', () => {
  test('prices the custom positions and keeps their provider errors', async () => {
    const { tokenPrices } = createTokenPrices(2)
    const providerErrors = [{ providerName: 'AAVE v3', error: 'RPC is down' }]

    const result = await priceCustomProviderPositions(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      customPositions: {
        positionsByProvider: [provider('Uniswap V3', [asset(USDC)])],
        providerErrors,
        error: null
      }
    })

    expect(result.error).toBeNull()
    expect(result.providerErrors).toBe(providerErrors)
    expect(result.positionsByProvider[0]!.positions[0]!.assets[0]!.priceIn).toEqual({
      baseCurrency: 'usd',
      price: 2
    })
  })

  test('reports a price error when the prices cannot be fetched', async () => {
    const { restore } = suppressConsole()
    const { tokenPrices } = createTokenPrices(2, new Error('cena is down'))

    const result = await priceCustomProviderPositions(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      customPositions: {
        positionsByProvider: [provider('Uniswap V3', [asset(USDC)])],
        providerErrors: [],
        error: null
      }
    })
    restore()

    expect(result.error).toBe(DeFiPositionsError.AssetPriceError)
  })

  test('keeps a critical error of the positions call over a price error', async () => {
    const { restore } = suppressConsole()
    const { tokenPrices } = createTokenPrices(2, new Error('cena is down'))

    const result = await priceCustomProviderPositions(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      customPositions: {
        positionsByProvider: [provider('Uniswap V3', [asset(USDC)])],
        providerErrors: [],
        error: DeFiPositionsError.CriticalError
      }
    })
    restore()

    expect(result.error).toBe(DeFiPositionsError.CriticalError)
  })
})
