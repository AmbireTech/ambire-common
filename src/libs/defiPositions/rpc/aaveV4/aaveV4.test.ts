import { Wallet } from 'ethers'
import { isAddress, maxUint256 } from 'viem'

import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../../../consts/networks'
import { Network } from '../../../../interfaces/network'
import { getRpcProvider } from '../../../../services/provider'
import { Deployless } from '../../../deployless/deployless'
import { AssetType } from '../../types'
import { AAVE_V4_SPOKES } from './addresses'
import {
  AAVE_V4_PROVIDER_NAME,
  AaveV4ReserveResult,
  AaveV4SpokeResult,
  getAaveV4Positions,
  getAaveV4SpokePosition
} from './aaveV4'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!
const polygon = networks.find(({ chainId }) => chainId === 137n)!
const MAIN_SPOKE = AAVE_V4_SPOKES['1']![0]!
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

const reserve = (overrides: Partial<AaveV4ReserveResult> = {}): AaveV4ReserveResult => ({
  reserveId: 0n,
  underlying: WETH,
  decimals: 18,
  symbol: 'WETH',
  name: 'Wrapped Ether',
  suppliedAssets: 0n,
  debt: 0n,
  isUsingAsCollateral: true,
  // 2000 USD, with the 8 decimals of the oracle
  price: 2000n * 10n ** 8n,
  hasPrice: true,
  ...overrides
})

const usdcReserve = (overrides: Partial<AaveV4ReserveResult> = {}) =>
  reserve({
    reserveId: 7n,
    underlying: USDC,
    decimals: 6,
    symbol: 'USDC',
    name: 'USD Coin',
    isUsingAsCollateral: false,
    price: 10n ** 8n,
    ...overrides
  })

const spokeResult = (overrides: Partial<AaveV4SpokeResult> = {}): AaveV4SpokeResult => ({
  spoke: MAIN_SPOKE.address,
  reserves: [],
  accountData: { healthFactor: maxUint256 },
  hasAccountData: true,
  priceDecimals: 8,
  hasPriceDecimals: true,
  ...overrides
})

// 10 WETH supplied, 5000 USDC borrowed
const borrowSpokeResult = () =>
  spokeResult({
    reserves: [
      reserve({ suppliedAssets: 10n * 10n ** 18n }),
      usdcReserve({ debt: 5000n * 10n ** 6n })
    ],
    accountData: { healthFactor: 3n * 10n ** 18n }
  })

describe('Aave v4 positions', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('getAaveV4SpokePosition', () => {
    test('a borrow position has its collateral, debt and health rate', () => {
      const position = getAaveV4SpokePosition(borrowSpokeResult(), MAIN_SPOKE)!

      expect(position.assets.map(({ symbol, type }) => [symbol, type])).toEqual([
        ['WETH', AssetType.Collateral],
        ['USDC', AssetType.Borrow]
      ])
      expect(position.assets.map(({ value }) => value)).toEqual([20000, 5000])
      expect(position.additionalData.positionInUSD).toBe(15000)
      expect(position.additionalData.healthRate).toBe(3)
    })
    test('is named after its market and identified by the spoke address', () => {
      const position = getAaveV4SpokePosition(borrowSpokeResult(), MAIN_SPOKE)!

      expect(position.id).toBe(MAIN_SPOKE.address.toLowerCase())
      expect(position.additionalData.positionIndex).toBe(MAIN_SPOKE.address.toLowerCase())
      expect(position.additionalData.name).toBe('Lending')
      expect(position.additionalData.description).toBe('Main market')
    })
    test('prices the assets by the oracle of the spoke', () => {
      const position = getAaveV4SpokePosition(borrowSpokeResult(), MAIN_SPOKE)!

      expect(position.assets[0]!.priceIn).toEqual({ baseCurrency: 'usd', price: 2000 })
    })
    test('has no health rate without debt', () => {
      const position = getAaveV4SpokePosition(
        spokeResult({ reserves: [usdcReserve({ suppliedAssets: 100n * 10n ** 6n })] }),
        MAIN_SPOKE
      )!

      expect(position.additionalData.healthRate).toBeNull()
      expect(position.additionalData.positionInUSD).toBe(100)
    })
    test('has no health rate when the spoke could not calculate it', () => {
      const position = getAaveV4SpokePosition(
        { ...borrowSpokeResult(), hasAccountData: false },
        MAIN_SPOKE
      )!

      expect(position.additionalData.healthRate).toBeNull()
    })
    test('has both assets of a reserve that is supplied and borrowed', () => {
      const position = getAaveV4SpokePosition(
        spokeResult({
          reserves: [usdcReserve({ suppliedAssets: 300n * 10n ** 6n, debt: 100n * 10n ** 6n })]
        }),
        MAIN_SPOKE
      )!

      expect(position.assets.map(({ type }) => type)).toEqual([
        AssetType.Collateral,
        AssetType.Borrow
      ])
      expect(position.additionalData.positionInUSD).toBe(200)
    })
    test('leaves the value of an asset without a price out', () => {
      const position = getAaveV4SpokePosition(
        spokeResult({
          reserves: [
            reserve({ suppliedAssets: 10n ** 18n, hasPrice: false, price: 0n }),
            usdcReserve({ suppliedAssets: 100n * 10n ** 6n })
          ]
        }),
        MAIN_SPOKE
      )!

      expect(position.assets[0]!.priceIn).toBeUndefined()
      expect(position.assets[0]!.value).toBeUndefined()
      expect(position.additionalData.positionInUSD).toBe(100)
    })
    test('has no prices when the decimals of the oracle are unknown', () => {
      const position = getAaveV4SpokePosition(
        { ...borrowSpokeResult(), hasPriceDecimals: false, priceDecimals: 0 },
        MAIN_SPOKE
      )!

      expect(position.assets.every(({ priceIn }) => !priceIn)).toBe(true)
      expect(position.additionalData.positionInUSD).toBe(0)
    })
    test('returns null for shares worth nothing (dust left after a withdrawal)', () => {
      expect(
        getAaveV4SpokePosition(spokeResult({ reserves: [reserve()] }), MAIN_SPOKE)
      ).toBeNull()
    })
  })

  describe('getAaveV4Positions', () => {
    const provider = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)
    const account = Wallet.createRandom().address

    test('reads the spokes of the network and has a position per spoke', async () => {
      const callSpy = jest
        .spyOn(Deployless.prototype, 'call')
        .mockResolvedValue([borrowSpokeResult()])

      const result = await getAaveV4Positions(account, provider, ethereum)

      expect(callSpy).toHaveBeenCalledWith('getAaveV4Positions', [
        account,
        AAVE_V4_SPOKES['1']!.map(({ address }) => address)
      ])
      expect(result!.providerName).toBe(AAVE_V4_PROVIDER_NAME)
      expect(result!.source).toBe('custom')
      expect(result!.type).toBe('lending')
      expect(result!.positions).toHaveLength(1)
      expect(result!.positionInUSD).toBe(15000)
    })
    test('leaves out spokes it did not ask for', async () => {
      jest
        .spyOn(Deployless.prototype, 'call')
        .mockResolvedValue([
          { ...borrowSpokeResult(), spoke: '0x0000000000000000000000000000000000000001' }
        ])

      expect(await getAaveV4Positions(account, provider, ethereum)).toBeNull()
    })
    test('returns null for an account without positions', async () => {
      jest.spyOn(Deployless.prototype, 'call').mockResolvedValue([])

      expect(await getAaveV4Positions(account, provider, ethereum)).toBeNull()
    })
    test('reads nothing on networks without Aave v4', async () => {
      const callSpy = jest.spyOn(Deployless.prototype, 'call')

      expect(await getAaveV4Positions(account, provider, polygon)).toBeNull()
      expect(callSpy).not.toHaveBeenCalled()
    })
  })

  describe('spokes', () => {
    test('has only unique, well-formed addresses and a name for every spoke', () => {
      Object.values(AAVE_V4_SPOKES).forEach((spokes) => {
        const addresses = spokes.map(({ address }) => address.toLowerCase())

        expect(new Set(addresses).size).toBe(addresses.length)
        spokes.forEach(({ address, name }) => {
          expect(isAddress(address)).toBe(true)
          expect(name).not.toBe('')
        })
      })
    })
  })

  // Every spoke of Ethereum is read, so a change of their interface fails these tests
  describe('reading positions on-chain (Ethereum)', () => {
    const provider = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)

    test.each([
      ['an RPC that supports state override', false],
      ['an RPC without state override', true]
    ])('returns null for an account without positions on %s', async (_, rpcNoStateOverride) => {
      const network: Network = { ...ethereum, rpcNoStateOverride }

      expect(
        await getAaveV4Positions(Wallet.createRandom().address, provider, network)
      ).toBeNull()
    })
  })
})
