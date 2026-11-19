import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { suppressConsole } from '../../../../test/helpers/console'
import { networks } from '../../../consts/networks'
import { ITokenPricesController } from '../../../interfaces/tokenPrices'
import { RPCProvider } from '../../../interfaces/provider'
import { TokenDataCacheValue } from '../../portfolio/interfaces'
import { DEBANK_UNI_V3 } from '../testData'
import {
  AssetType,
  DeFiPositionsError,
  NetworkState,
  PositionsByProvider,
  RpcDefiRead
} from '../types'
import { aaveV3DefiProvider } from './aaveV3/aaveV3'
import { TokenResult } from '../../portfolio/interfaces'
import {
  ALWAYS_FETCHED_PROVIDERS,
  FETCHED_WITHOUT_API_PROVIDERS,
  getHeldTokenAddresses,
  getReusableRpcDefiRead,
  getRpcDefiPositions
} from './index'
import { aaveV4DefiProvider } from './aaveV4/aaveV4'
import { morphoDefiProvider } from './morpho/morpho'
import { uniswapV3DefiProvider } from './uniswapV3/uniswapV3'

const polygon = networks.find((n) => n.chainId === 137n)!
const ACCOUNT = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
// The providers are mocked, so the RPC provider is never used
const rpcProvider = {} as RPCProvider

const getPositions = (
  providerName: string,
  source: PositionsByProvider['source'],
  positionIndex = '1'
): PositionsByProvider => ({
  providerName,
  chainId: 137n,
  source,
  iconUrl: '',
  siteUrl: '',
  type: 'common',
  positions: [
    {
      id: positionIndex,
      additionalData: { positionIndex, positionInUSD: 10 },
      assets: [
        {
          address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
          symbol: 'WPOL',
          name: 'Wrapped POL',
          decimals: 18,
          iconUrl: '',
          amount: 1n,
          priceIn: { baseCurrency: 'usd', price: 1 },
          type: AssetType.Liquidity
        }
      ]
    }
  ]
})

/** A token prices service that prices every requested token at 1 USD */
const createTokenPrices = () => {
  const getTokenData = jest.fn(async ({ tokenAddresses }: { tokenAddresses: string[] }) => ({
    tokenData: new Map<string, TokenDataCacheValue>(
      tokenAddresses.map((address) => [
        address.toLowerCase(),
        { priceIn: [{ baseCurrency: 'usd', price: 1 }], marketDataIn: [] }
      ])
    ),
    error: null
  }))

  return { tokenPrices: { getTokenData } as unknown as ITokenPricesController, getTokenData }
}

/** Mocks the positions read from the chain by every protocol. A protocol not passed has none */
const mockFetchedPositions = (positions: {
  aave?: PositionsByProvider | null | Error
  uniswap?: PositionsByProvider | null | Error
  morpho?: PositionsByProvider | null | Error
  aaveV4?: PositionsByProvider | null | Error
}) => {
  const toImplementation = (result: PositionsByProvider | null | Error | undefined) => async () => {
    if (result instanceof Error) throw result
    return result ?? null
  }

  return {
    aaveSpy: jest
      .spyOn(aaveV3DefiProvider, 'fetchPositions')
      .mockImplementation(toImplementation(positions.aave)),
    uniswapSpy: jest
      .spyOn(uniswapV3DefiProvider, 'fetchPositions')
      .mockImplementation(toImplementation(positions.uniswap)),
    morphoSpy: jest
      .spyOn(morphoDefiProvider, 'fetchPositions')
      .mockImplementation(toImplementation(positions.morpho)),
    aaveV4Spy: jest
      .spyOn(aaveV4DefiProvider, 'fetchPositions')
      .mockImplementation(toImplementation(positions.aaveV4))
  }
}

const callGetRpcDefiPositions = (
  params: Partial<Parameters<typeof getRpcDefiPositions>[1]> = {}
) => {
  const { tokenPrices } = createTokenPrices()

  return getRpcDefiPositions(tokenPrices, {
    accountAddr: ACCOUNT,
    provider: rpcProvider,
    network: polygon,
    heldTokenAddresses: [],
    previousPositions: [],
    apiPositions: [],
    isAutoDiscoveryEnabled: true,
    reusableRead: null,
    ...params
  })
}

const getUniswapV3 = (positionsByProvider: PositionsByProvider[]) =>
  positionsByProvider.find((p) => p.providerName === 'Uniswap V3')

describe('getRpcDefiPositions', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('the protocols the API returns are always read from the chain', () => {
    expect(ALWAYS_FETCHED_PROVIDERS.map(({ name }) => name).sort()).toEqual([
      'AAVE v3',
      'Uniswap V3'
    ])
  })

  test('the protocols the API returns fully are read from the chain only without the API', () => {
    expect(FETCHED_WITHOUT_API_PROVIDERS.map(({ name }) => name)).toEqual(['Morpho', 'AAVE v4'])
  })

  test('passes the tokens the account holds to the protocols', async () => {
    const { morphoSpy } = mockFetchedPositions({})
    const heldTokenAddresses = ['0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270']

    await callGetRpcDefiPositions({ isAutoDiscoveryEnabled: false, heldTokenAddresses })

    expect(morphoSpy).toHaveBeenCalledWith(expect.objectContaining({ heldTokenAddresses }))
  })

  describe('with auto discovery on', () => {
    test('reads only the protocols that are always read from the chain', async () => {
      const { aaveSpy, uniswapSpy, morphoSpy, aaveV4Spy } = mockFetchedPositions({
        morpho: getPositions('Morpho', 'custom')
      })

      const res = await callGetRpcDefiPositions()

      expect(aaveSpy).toHaveBeenCalledTimes(1)
      expect(uniswapSpy).toHaveBeenCalledTimes(1)
      expect(morphoSpy).not.toHaveBeenCalled()
      expect(aaveV4Spy).not.toHaveBeenCalled()
      expect(res.positionsByProvider).toEqual([])
    })
    test('merges the positions with those of the API', async () => {
      const apiUniV3 = DEBANK_UNI_V3[0]!
      const rpcUniV3 = getPositions(
        'Uniswap V3',
        'custom',
        apiUniV3.positions[0]!.additionalData.positionIndex
      )
      mockFetchedPositions({ uniswap: rpcUniV3 })

      const res = await callGetRpcDefiPositions({ apiPositions: [apiUniV3] })

      expect(getUniswapV3(res.positionsByProvider)?.source).toBe('mixed')
      expect(getUniswapV3(res.positionsByProvider)?.positions).toHaveLength(
        apiUniV3.positions.length
      )
    })
    test('merges with the previous API positions when the API call failed or was skipped', async () => {
      const previousMixedUniV3: PositionsByProvider = { ...DEBANK_UNI_V3[0]!, source: 'mixed' }
      mockFetchedPositions({ uniswap: getPositions('Uniswap V3', 'custom', 'new-on-chain') })

      const res = await callGetRpcDefiPositions({
        previousPositions: [previousMixedUniV3],
        apiPositions: undefined
      })
      const uniswapV3 = getUniswapV3(res.positionsByProvider)

      expect(uniswapV3?.source).toBe('mixed')
      expect(uniswapV3?.positions.map((p) => p.additionalData.positionIndex)).toContain(
        'new-on-chain'
      )
    })
    test('returns the positions read from the chain when the API did not return the protocol', async () => {
      const rpcUniV3 = getPositions('Uniswap V3', 'custom')
      mockFetchedPositions({ uniswap: rpcUniV3 })

      const res = await callGetRpcDefiPositions({ apiPositions: [] })

      expect(getUniswapV3(res.positionsByProvider)).toEqual(rpcUniV3)
    })
    test('replaces the API positions of a protocol that cannot be merged (AAVE)', async () => {
      const rpcAave = getPositions('AAVE v3', 'custom')
      mockFetchedPositions({ aave: rpcAave })

      const res = await callGetRpcDefiPositions({
        apiPositions: [getPositions('Aave V3', 'debank')]
      })

      expect(res.positionsByProvider).toEqual([rpcAave])
    })
  })

  describe('with auto discovery off', () => {
    test('reads all the protocols from the chain', async () => {
      const morpho = getPositions('Morpho', 'custom')
      const rpcAaveV4 = getPositions('AAVE v4', 'custom')
      const { aaveSpy, uniswapSpy, morphoSpy, aaveV4Spy } = mockFetchedPositions({
        morpho,
        aaveV4: rpcAaveV4
      })

      const res = await callGetRpcDefiPositions({ isAutoDiscoveryEnabled: false })

      expect(aaveSpy).toHaveBeenCalledTimes(1)
      expect(uniswapSpy).toHaveBeenCalledTimes(1)
      expect(morphoSpy).toHaveBeenCalledTimes(1)
      expect(aaveV4Spy).toHaveBeenCalledTimes(1)
      expect(res.positionsByProvider).toEqual([morpho, rpcAaveV4])
    })
    test('never merges with API positions, new or previous', async () => {
      const apiUniV3 = DEBANK_UNI_V3[0]!
      const rpcUniV3 = getPositions(
        'Uniswap V3',
        'custom',
        apiUniV3.positions[0]!.additionalData.positionIndex
      )
      mockFetchedPositions({ uniswap: rpcUniV3 })
      const mergeSpy = jest.spyOn(uniswapV3DefiProvider, 'mergeWithApiPositions')

      const res = await callGetRpcDefiPositions({
        isAutoDiscoveryEnabled: false,
        previousPositions: [{ ...apiUniV3, source: 'mixed' }],
        apiPositions: DEBANK_UNI_V3
      })

      expect(mergeSpy).not.toHaveBeenCalled()
      expect(getUniswapV3(res.positionsByProvider)).toEqual(rpcUniV3)
    })
  })

  describe('the read', () => {
    test('has what each protocol read, before it was merged with the API positions', async () => {
      const apiUniV3 = DEBANK_UNI_V3[0]!
      const rpcUniV3 = getPositions(
        'Uniswap V3',
        'custom',
        apiUniV3.positions[0]!.additionalData.positionIndex
      )
      mockFetchedPositions({ uniswap: rpcUniV3 })
      const readStartedAt = Date.now()

      const res = await callGetRpcDefiPositions({ apiPositions: [apiUniV3] })

      expect(getUniswapV3(res.positionsByProvider)?.source).toBe('mixed')
      expect(res.rpcRead?.positionsByProviderName).toEqual({
        'AAVE v3': null,
        'Uniswap V3': rpcUniV3
      })
      expect(res.rpcRead?.readAt).toBeGreaterThanOrEqual(readStartedAt)
    })
    test('is left out when a protocol fails, so the next update reads them all again', async () => {
      mockFetchedPositions({ morpho: new Error('Morpho error') })

      const res = await callGetRpcDefiPositions({ isAutoDiscoveryEnabled: false })

      expect(res.rpcRead).toBeUndefined()
    })
    test('is kept when an asset cannot be priced, as the price is requested on every update', async () => {
      const { restore } = suppressConsole()
      const rpcUniV3 = getPositions('Uniswap V3', 'custom')
      delete rpcUniV3.positions[0]!.assets[0]!.priceIn
      mockFetchedPositions({ uniswap: rpcUniV3 })
      const failingTokenPrices = {
        getTokenData: jest.fn(async () => ({
          tokenData: new Map<string, TokenDataCacheValue>(),
          error: new Error('Prices error')
        }))
      } as unknown as ITokenPricesController

      const res = await getRpcDefiPositions(failingTokenPrices, {
        accountAddr: ACCOUNT,
        provider: rpcProvider,
        network: polygon,
        heldTokenAddresses: [],
        previousPositions: [],
        apiPositions: undefined,
        isAutoDiscoveryEnabled: false,
        reusableRead: null
      })
      restore()

      expect(res.error).toBe(DeFiPositionsError.AssetPriceError)
      expect(res.rpcRead).toBeDefined()
    })
  })

  describe('with a previous read to reuse', () => {
    const getRead = (positionsByProviderName: RpcDefiRead['positionsByProviderName']) => ({
      positionsByProviderName,
      readAt: 1
    })

    test('takes the positions from the read instead of the chain', async () => {
      const rpcAave = getPositions('AAVE v3', 'custom')
      const rpcMorpho = getPositions('Morpho', 'custom')
      const { aaveSpy, uniswapSpy, morphoSpy, aaveV4Spy } = mockFetchedPositions({})

      const res = await callGetRpcDefiPositions({
        isAutoDiscoveryEnabled: false,
        reusableRead: getRead({
          'AAVE v3': rpcAave,
          'Uniswap V3': null,
          Morpho: rpcMorpho,
          'AAVE v4': null
        })
      })

      expect(aaveSpy).not.toHaveBeenCalled()
      expect(uniswapSpy).not.toHaveBeenCalled()
      expect(morphoSpy).not.toHaveBeenCalled()
      expect(aaveV4Spy).not.toHaveBeenCalled()
      expect(res.positionsByProvider).toEqual([rpcAave, rpcMorpho])
    })
    test('merges the read with the new API positions, so what only the chain has is kept', async () => {
      const apiUniV3 = DEBANK_UNI_V3[0]!
      const rpcUniV3 = getPositions(
        'Uniswap V3',
        'custom',
        apiUniV3.positions[0]!.additionalData.positionIndex
      )
      rpcUniV3.positions[0]!.additionalData.inRange = true
      const { uniswapSpy } = mockFetchedPositions({})

      const res = await callGetRpcDefiPositions({
        apiPositions: [apiUniV3],
        reusableRead: getRead({ 'AAVE v3': null, 'Uniswap V3': rpcUniV3 })
      })
      const uniswapV3 = getUniswapV3(res.positionsByProvider)

      expect(uniswapSpy).not.toHaveBeenCalled()
      expect(uniswapV3?.source).toBe('mixed')
      expect(uniswapV3?.positions[0]!.additionalData.inRange).toBe(true)
    })
    test('reads the protocols the read does not have (made while auto discovery was on)', async () => {
      const rpcMorpho = getPositions('Morpho', 'custom')
      const { aaveSpy, uniswapSpy, morphoSpy, aaveV4Spy } = mockFetchedPositions({
        morpho: rpcMorpho
      })

      const res = await callGetRpcDefiPositions({
        isAutoDiscoveryEnabled: false,
        reusableRead: getRead({ 'AAVE v3': null, 'Uniswap V3': null })
      })

      expect(aaveSpy).not.toHaveBeenCalled()
      expect(uniswapSpy).not.toHaveBeenCalled()
      expect(morphoSpy).toHaveBeenCalledTimes(1)
      expect(aaveV4Spy).toHaveBeenCalledTimes(1)
      expect(res.positionsByProvider).toEqual([rpcMorpho])
    })
    test('keeps the time of the read, so it is not reused for longer than allowed', async () => {
      mockFetchedPositions({})

      const res = await callGetRpcDefiPositions({
        reusableRead: getRead({ 'AAVE v3': null, 'Uniswap V3': null })
      })

      expect(res.rpcRead?.readAt).toBe(1)
    })
    test('prices the assets of the read that have no price', async () => {
      const rpcUniV3 = getPositions('Uniswap V3', 'custom')
      delete rpcUniV3.positions[0]!.assets[0]!.priceIn
      mockFetchedPositions({})
      const { tokenPrices, getTokenData } = createTokenPrices()

      const res = await getRpcDefiPositions(tokenPrices, {
        accountAddr: ACCOUNT,
        provider: rpcProvider,
        network: polygon,
        heldTokenAddresses: [],
        previousPositions: [],
        apiPositions: [],
        isAutoDiscoveryEnabled: true,
        reusableRead: getRead({ 'AAVE v3': null, 'Uniswap V3': rpcUniV3 })
      })

      expect(getTokenData).toHaveBeenCalledTimes(1)
      expect(getUniswapV3(res.positionsByProvider)?.positions[0]!.assets[0]!.priceIn).toEqual({
        baseCurrency: 'usd',
        price: 1
      })
    })
  })

  describe('previous positions', () => {
    const storedPositions = [
      getPositions('Uniswap V3', 'custom'),
      getPositions('AAVE v3', 'custom')
    ]

    test('drops stored positions the user closed since the last update', async () => {
      mockFetchedPositions({ aave: null, uniswap: null })

      const res = await callGetRpcDefiPositions({ previousPositions: storedPositions })

      expect(res.providerErrors).toEqual([])
      expect(res.positionsByProvider).toEqual([])
    })
    test('keeps stored positions when their provider fails to update', async () => {
      mockFetchedPositions({ aave: new Error('AAVE error'), uniswap: new Error('Uniswap error') })

      const res = await callGetRpcDefiPositions({ previousPositions: storedPositions })

      expect(res.providerErrors).toEqual(
        expect.arrayContaining([
          { providerName: 'AAVE v3', error: 'AAVE error' },
          { providerName: 'Uniswap V3', error: 'Uniswap error' }
        ])
      )
      expect(res.positionsByProvider).toEqual(storedPositions)
    })
    test('keeps only the stored positions of the provider that failed', async () => {
      const newUniV3 = getPositions('Uniswap V3', 'custom', '2')
      mockFetchedPositions({ aave: new Error('AAVE error'), uniswap: newUniV3 })

      const res = await callGetRpcDefiPositions({ previousPositions: storedPositions })

      expect(res.positionsByProvider).toEqual([storedPositions[1], newUniV3])
    })
    describe('of protocols read from the chain only without the API (Morpho)', () => {
      const previousRpcMorpho = getPositions('Morpho', 'custom')

      test('are kept while the API call fails or is skipped right after auto discovery is turned on', async () => {
        const { morphoSpy } = mockFetchedPositions({})

        const res = await callGetRpcDefiPositions({
          previousPositions: [previousRpcMorpho],
          apiPositions: undefined
        })

        expect(morphoSpy).not.toHaveBeenCalled()
        expect(res.positionsByProvider).toEqual([previousRpcMorpho])
      })
      test('are dropped once the API returns positions, as it returns those of Morpho too', async () => {
        mockFetchedPositions({})

        const res = await callGetRpcDefiPositions({
          previousPositions: [previousRpcMorpho],
          apiPositions: []
        })

        expect(res.positionsByProvider).toEqual([])
      })
      test('are kept when reading them fails with auto discovery off', async () => {
        mockFetchedPositions({ morpho: new Error('Morpho error') })

        const res = await callGetRpcDefiPositions({
          isAutoDiscoveryEnabled: false,
          previousPositions: [previousRpcMorpho]
        })

        expect(res.providerErrors).toEqual([{ providerName: 'Morpho', error: 'Morpho error' }])
        expect(res.positionsByProvider).toEqual([previousRpcMorpho])
      })
      test('are dropped when the account closed them, with auto discovery off', async () => {
        mockFetchedPositions({ morpho: null })

        const res = await callGetRpcDefiPositions({
          isAutoDiscoveryEnabled: false,
          previousPositions: [previousRpcMorpho]
        })

        expect(res.positionsByProvider).toEqual([])
      })
      test('the API positions of Morpho are never kept as positions read from the chain', async () => {
        mockFetchedPositions({})

        const res = await callGetRpcDefiPositions({
          previousPositions: [getPositions('Morpho', 'debank')],
          apiPositions: undefined
        })

        expect(res.positionsByProvider).toEqual([])
      })
    })
    test('never keeps stored API positions of a failed provider as positions read from the chain', async () => {
      mockFetchedPositions({ uniswap: new Error('Uniswap error') })

      const res = await callGetRpcDefiPositions({
        previousPositions: [{ ...DEBANK_UNI_V3[0]!, source: 'mixed' }]
      })

      expect(getUniswapV3(res.positionsByProvider)).toBeUndefined()
    })
  })

  test('reads nothing on a disabled network', async () => {
    const { aaveSpy, uniswapSpy } = mockFetchedPositions({})

    const res = await callGetRpcDefiPositions({
      network: { ...polygon, disabled: true },
      previousPositions: [getPositions('AAVE v3', 'custom')]
    })

    expect(aaveSpy).not.toHaveBeenCalled()
    expect(uniswapSpy).not.toHaveBeenCalled()
    expect(res).toEqual({ positionsByProvider: [], providerErrors: [] })
  })

  test('prices the assets read from the chain that have no price', async () => {
    const rpcUniV3 = getPositions('Uniswap V3', 'custom')
    delete rpcUniV3.positions[0]!.assets[0]!.priceIn
    mockFetchedPositions({ uniswap: rpcUniV3 })
    const { tokenPrices, getTokenData } = createTokenPrices()

    const res = await getRpcDefiPositions(tokenPrices, {
      accountAddr: ACCOUNT,
      provider: rpcProvider,
      network: polygon,
      heldTokenAddresses: [],
      previousPositions: [],
      apiPositions: [],
      isAutoDiscoveryEnabled: true,
      reusableRead: null
    })

    expect(getTokenData).toHaveBeenCalledTimes(1)
    expect(getUniswapV3(res.positionsByProvider)?.positions[0]!.assets[0]!.priceIn).toEqual({
      baseCurrency: 'usd',
      price: 1
    })
  })
})

describe('getReusableRpcDefiRead', () => {
  const ONE_MINUTE = 60 * 1000
  const getRead = (readAt = Date.now() - ONE_MINUTE): RpcDefiRead => ({
    positionsByProviderName: { Morpho: getPositions('Morpho', 'custom') },
    readAt
  })
  // Without a read, as the last one failed
  const getPreviousState = (rpcRead?: RpcDefiRead): NetworkState => ({
    positionsByProvider: [getPositions('Morpho', 'custom')],
    rpcRead,
    error: null,
    providerErrors: []
  })
  // An update that doesn't need fresh DeFi positions, like the periodic one
  const callGetReusableRpcDefiRead = (
    params: Partial<Parameters<typeof getReusableRpcDefiRead>[0]> = {}
  ) =>
    getReusableRpcDefiRead({
      previousState: getPreviousState(getRead()),
      isManualUpdate: false,
      bypassServerSideCache: false,
      hasNonceChangedSinceLastUpdate: false,
      maxDataAgeMs: -1,
      ...params
    })

  test('reuses the previous read on an update that does not need fresh positions', () => {
    const rpcRead = getRead(1)

    expect(callGetReusableRpcDefiRead({ previousState: getPreviousState(rpcRead) })).toBe(rpcRead)
  })
  test('reuses the previous read while it is younger than maxDataAgeMs', () => {
    expect(callGetReusableRpcDefiRead({ maxDataAgeMs: 2 * ONE_MINUTE })).not.toBeNull()
  })
  test('reads the positions again once the read is older than maxDataAgeMs', () => {
    expect(callGetReusableRpcDefiRead({ maxDataAgeMs: ONE_MINUTE / 2 })).toBeNull()
  })
  test('reads the positions again when fresh ones are requested (maxDataAgeMs of 0)', () => {
    expect(
      callGetReusableRpcDefiRead({
        previousState: getPreviousState(getRead(Date.now())),
        maxDataAgeMs: 0
      })
    ).toBeNull()
  })
  test('reads the positions again when the user refreshes', () => {
    expect(callGetReusableRpcDefiRead({ isManualUpdate: true })).toBeNull()
  })
  test('reads the positions again after a transaction or a signed message (scheduled update)', () => {
    expect(callGetReusableRpcDefiRead({ bypassServerSideCache: true })).toBeNull()
  })
  test('reads the positions again when the account sent a transaction', () => {
    expect(callGetReusableRpcDefiRead({ hasNonceChangedSinceLastUpdate: true })).toBeNull()
  })
  test('reads the positions on the first update', () => {
    expect(callGetReusableRpcDefiRead({ previousState: undefined })).toBeNull()
  })
  test('retries a read that failed', () => {
    expect(callGetReusableRpcDefiRead({ previousState: getPreviousState() })).toBeNull()
  })
})

describe('getHeldTokenAddresses', () => {
  const token = (
    address: string,
    overrides: { amount?: bigint; flags?: Partial<TokenResult['flags']> } = {}
  ): TokenResult => ({
    symbol: 'TKN',
    name: 'Token',
    decimals: 18,
    address,
    chainId: 1n,
    amount: overrides.amount ?? 10n ** 18n,
    priceIn: [],
    marketDataIn: [],
    flags: {
      onGasTank: false,
      rewardsType: null,
      canTopUpGasTank: false,
      isFeeToken: false,
      ...overrides.flags
    }
  })

  test('returns the tokens the account holds', () => {
    expect(getHeldTokenAddresses([token('0x01'), token('0x02')])).toEqual(['0x01', '0x02'])
  })

  test('returns nothing without tokens', () => {
    expect(getHeldTokenAddresses(undefined)).toEqual([])
  })

  test('leaves out tokens with no balance and those held elsewhere', () => {
    expect(
      getHeldTokenAddresses([
        token('0x01', { amount: 0n }),
        token('0x02', { flags: { rewardsType: 'wallet-rewards' } }),
        token('0x03', { flags: { onGasTank: true } }),
        token('0x04')
      ])
    ).toEqual(['0x04'])
  })

  test('leaves out spam and hidden tokens, so the shares of a vault airdropped to the account add no balance', () => {
    expect(
      getHeldTokenAddresses([
        token('0x01', { flags: { suspectedType: 'suspected' } }),
        token('0x02', { flags: { isHidden: true } }),
        token('0x03')
      ])
    ).toEqual(['0x03'])
  })
})
