import { describe, expect, jest, test } from '@jest/globals'

import { suppressConsole } from '../../../../test/helpers/console'
import { networks } from '../../../consts/networks'
import { ITokenPricesController } from '../../../interfaces/tokenPrices'
import { TokenDataCacheValue } from '../../portfolio/interfaces'
import { withCollateralValues } from '../helpers'
import { AssetType, DeFiPositionsError, PositionAsset, PositionsByProvider } from '../types'
import { priceRpcDefiPositions } from './index'
import { updatePositionsByProviderAssetPrices } from './prices'

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

  describe('positions with a loan (e.g. a Morpho market)', () => {
    const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
    // 0.39 WBTC supplied, worth $24,955, and 9,233.63 USDC borrowed against it
    const suppliedWbtc = asset(WBTC, {
      type: AssetType.Collateral,
      decimals: 8,
      amount: 39_000_000n,
      priceIn: { baseCurrency: 'usd', price: 24_955 / 0.39 },
      value: 24_955
    })
    const borrowedUsdc = asset(USDC, {
      type: AssetType.Borrow,
      decimals: 6,
      amount: 9_233_630_000n
    })

    test('subtracts the borrowed assets from the value of the position and the app', async () => {
      const { tokenPrices } = createTokenPrices(1)

      const { positionsByProvider } = await updatePositionsByProviderAssetPrices(tokenPrices, {
        network: ethereum,
        positionsByProvider: [provider('Morpho', [suppliedWbtc, borrowedUsdc])]
      })

      const morpho = positionsByProvider[0]!
      expect(morpho.positions[0]!.assets[1]!.value).toBeCloseTo(9_233.63)
      expect(morpho.positions[0]!.additionalData.positionInUSD).toBeCloseTo(24_955 - 9_233.63)
      expect(morpho.positionInUSD).toBeCloseTo(24_955 - 9_233.63)
    })

    test('counts the loan once when it is added back to show the value without loans subtracted', async () => {
      const { tokenPrices } = createTokenPrices(1)

      const { positionsByProvider } = await updatePositionsByProviderAssetPrices(tokenPrices, {
        network: ethereum,
        positionsByProvider: [provider('Morpho', [suppliedWbtc, borrowedUsdc])]
      })
      const morpho = withCollateralValues(positionsByProvider[0]!)

      // The supplied WBTC, not $43,422 (the WBTC plus the loan counted twice)
      expect(morpho.positions[0]!.additionalData.collateralInUSD).toBeCloseTo(24_955)
      expect(morpho.collateralInUSD).toBeCloseTo(24_955)
    })

    test('adds nothing for a borrowed asset without a price', async () => {
      const { tokenPrices } = createTokenPrices(1, new Error('The prices could not be fetched'))

      const { positionsByProvider } = await updatePositionsByProviderAssetPrices(tokenPrices, {
        network: ethereum,
        positionsByProvider: [provider('Morpho', [suppliedWbtc, borrowedUsdc])]
      })

      expect(positionsByProvider[0]!.positions[0]!.assets[1]!.value).toBeUndefined()
      expect(positionsByProvider[0]!.positions[0]!.additionalData.positionInUSD).toBe(24_955)
    })
  })

  describe('assets with a price fallback (e.g. Morpho collateral valued by the market oracle)', () => {
    const PT_TOKEN = '0x0000000000000000000000000000000000000071'
    // 1 PT is worth 3000 USDC by the protocol's oracle
    const collateral = asset(PT_TOKEN, {
      type: AssetType.Collateral,
      priceFallback: { address: USDC, decimals: 6, amount: 3000n * 10n ** 6n }
    })
    /** Prices only the given tokens, at 1 USD */
    const createSelectiveTokenPrices = (pricedAddresses: string[]) => {
      const getTokenData = jest.fn(async ({ tokenAddresses }: { tokenAddresses: string[] }) => ({
        tokenData: new Map<string, TokenDataCacheValue>(
          tokenAddresses
            .filter((address) => pricedAddresses.includes(address))
            .map((address) => [
              address.toLowerCase(),
              { priceIn: [{ baseCurrency: 'usd', price: 1 }], marketDataIn: [] }
            ])
        ),
        error: null
      }))

      return { tokenPrices: { getTokenData } as unknown as ITokenPricesController, getTokenData }
    }

    test('values an asset without a price through the fallback token', async () => {
      const { tokenPrices, getTokenData } = createSelectiveTokenPrices([USDC])

      const { positionsByProvider } = await updatePositionsByProviderAssetPrices(tokenPrices, {
        network: ethereum,
        positionsByProvider: [
          provider('Morpho', [
            collateral,
            asset(USDC, { type: AssetType.Borrow, decimals: 6, amount: 1000n * 10n ** 6n })
          ])
        ]
      })

      expect(getTokenData.mock.calls[0]![0].tokenAddresses).toContain(USDC)
      const [pricedCollateral] = positionsByProvider[0]!.positions[0]!.assets
      expect(pricedCollateral!.priceIn).toEqual({ baseCurrency: 'usd', price: 3000 })
      expect(pricedCollateral!.value).toBe(3000)
      // $3000 collateral minus the $1000 borrowed. Without the fallback, the collateral would
      // add nothing to the position's value
      expect(positionsByProvider[0]!.positions[0]!.additionalData.positionInUSD).toBe(2000)
    })

    test("prefers the asset's own price", async () => {
      const { tokenPrices } = createSelectiveTokenPrices([USDC, PT_TOKEN])

      const { positionsByProvider } = await updatePositionsByProviderAssetPrices(tokenPrices, {
        network: ethereum,
        positionsByProvider: [provider('Morpho', [collateral])]
      })

      expect(positionsByProvider[0]!.positions[0]!.assets[0]!.priceIn).toEqual({
        baseCurrency: 'usd',
        price: 1
      })
    })

    test('leaves the asset unpriced when the fallback token has no price either', async () => {
      const { tokenPrices } = createSelectiveTokenPrices([])

      const { positionsByProvider } = await updatePositionsByProviderAssetPrices(tokenPrices, {
        network: ethereum,
        positionsByProvider: [provider('Morpho', [collateral])]
      })

      expect(positionsByProvider[0]!.positions[0]!.assets[0]!.priceIn).toBeUndefined()
    })
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

describe('priceRpcDefiPositions', () => {
  test('prices the positions read from the chain and keeps their provider errors', async () => {
    const { tokenPrices } = createTokenPrices(2)
    const providerErrors = [{ providerName: 'AAVE v3', error: 'RPC is down' }]

    const result = await priceRpcDefiPositions(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      rpcPositions: {
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

    const result = await priceRpcDefiPositions(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      rpcPositions: {
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

    const result = await priceRpcDefiPositions(tokenPrices, {
      network: ethereum,
      accountAddr: ACCOUNT,
      rpcPositions: {
        positionsByProvider: [provider('Uniswap V3', [asset(USDC)])],
        providerErrors: [],
        error: DeFiPositionsError.CriticalError
      }
    })
    restore()

    expect(result.error).toBe(DeFiPositionsError.CriticalError)
  })
})
