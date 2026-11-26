import { Wallet } from 'ethers'
import { isAddress } from 'viem'

import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../../../consts/networks'
import { Network } from '../../../../interfaces/network'
import { getRpcProvider } from '../../../../services/provider'
import { Deployless } from '../../../deployless/deployless'
import { AssetType, PositionsByProvider } from '../../types'
import { UNISWAP_V2_FACTORIES } from './addresses'
import {
  getUniswapV2PairsFromApiPositions,
  getUniswapV2Position,
  getUniswapV2Positions,
  UNISWAP_V2_PROVIDER_NAME,
  UniswapV2PairResult
} from './uniswapV2'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
/** The USDC / WETH pair of Uniswap V2 on Ethereum */
const UNI_V2_USDC_WETH = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'
/** The USDC / WETH pair of SushiSwap, a fork of Uniswap V2 with its own factory */
const SUSHI_USDC_WETH = '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0'

const tokenInfo = (symbol: string, decimals: number) => ({
  symbol,
  name: symbol,
  decimals,
  hasDecimals: true
})

// 10% of a pair with 2,000,000 USDC and 1,000 WETH
const pairResult = (overrides: Partial<UniswapV2PairResult> = {}): UniswapV2PairResult => ({
  pair: UNI_V2_USDC_WETH,
  balance: 10n ** 17n,
  totalSupply: 10n ** 18n,
  token0: USDC,
  token1: WETH,
  reserve0: 2_000_000n * 10n ** 6n,
  reserve1: 1000n * 10n ** 18n,
  token0Info: tokenInfo('USDC', 6),
  token1Info: tokenInfo('WETH', 18),
  ...overrides
})

describe('Uniswap V2 positions', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('getUniswapV2Position', () => {
    test("holds the account's share of the reserves of the pair", () => {
      const position = getUniswapV2Position(pairResult())!

      expect(position.assets.map(({ symbol, amount, type }) => [symbol, amount, type])).toEqual([
        ['USDC', 200_000n * 10n ** 6n, AssetType.Liquidity],
        ['WETH', 100n * 10n ** 18n, AssetType.Liquidity]
      ])
    })
    test('is identified by the pair and named after its tokens', () => {
      const position = getUniswapV2Position(pairResult())!

      expect(position.id).toBe(UNI_V2_USDC_WETH.toLowerCase())
      expect(position.additionalData.positionIndex).toBe(UNI_V2_USDC_WETH.toLowerCase())
      expect(position.additionalData.name).toBe('Liquidity Pool')
      expect(position.additionalData.description).toBe('USDC / WETH')
    })
    test('links the liquidity token of the pair, so its value is not counted twice', () => {
      const position = getUniswapV2Position(pairResult())!

      expect(position.additionalData.pool).toEqual({
        id: UNI_V2_USDC_WETH.toLowerCase(),
        controller: UNI_V2_USDC_WETH
      })
    })
    test('has no description when a token has no symbol', () => {
      const position = getUniswapV2Position(pairResult({ token1Info: { ...tokenInfo('', 18) } }))!

      expect(position.additionalData.description).toBeUndefined()
    })
    test('is not displayed when a token did not return its decimals', () => {
      expect(
        getUniswapV2Position(
          pairResult({ token0Info: { symbol: '', name: '', decimals: 0, hasDecimals: false } })
        )
      ).toBeNull()
    })
    test('returns null for a share worth nothing or a pair without supply', () => {
      expect(getUniswapV2Position(pairResult({ balance: 1n, totalSupply: 10n ** 30n }))).toBeNull()
      expect(getUniswapV2Position(pairResult({ totalSupply: 0n }))).toBeNull()
    })
  })

  describe('getUniswapV2Positions', () => {
    const provider = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)
    const account = Wallet.createRandom().address

    test('checks the unique and valid token addresses against the factory of the network', async () => {
      const callSpy = jest.spyOn(Deployless.prototype, 'call').mockResolvedValue([pairResult()])

      const result = await getUniswapV2Positions(account, provider, ethereum, [
        UNI_V2_USDC_WETH,
        UNI_V2_USDC_WETH.toLowerCase(),
        'not-an-address',
        USDC
      ])

      expect(callSpy).toHaveBeenCalledWith('getUniswapV2Positions', [
        account,
        UNISWAP_V2_FACTORIES['1'],
        [UNI_V2_USDC_WETH.toLowerCase(), USDC.toLowerCase()]
      ])
      expect(result!.providerName).toBe(UNISWAP_V2_PROVIDER_NAME)
      expect(result!.source).toBe('custom')
      expect(result!.positions).toHaveLength(1)
    })
    test('splits many tokens into calls of 100, so a call stays below the limits of the RPC', async () => {
      const callSpy = jest.spyOn(Deployless.prototype, 'call').mockResolvedValue([])
      const tokens = Array.from({ length: 250 }, () => Wallet.createRandom().address)

      await getUniswapV2Positions(account, provider, ethereum, tokens)

      expect(callSpy.mock.calls.map(([, args]) => (args[2] as string[]).length)).toEqual([
        100, 100, 50
      ])
    })
    test('reads nothing without tokens or on networks without Uniswap V2', async () => {
      const callSpy = jest.spyOn(Deployless.prototype, 'call')
      const networkWithoutUniswapV2: Network = { ...ethereum, chainId: 1337n }

      expect(await getUniswapV2Positions(account, provider, ethereum, [])).toBeNull()
      expect(
        await getUniswapV2Positions(account, provider, networkWithoutUniswapV2, [UNI_V2_USDC_WETH])
      ).toBeNull()
      expect(callSpy).not.toHaveBeenCalled()
    })
  })

  describe('getUniswapV2PairsFromApiPositions', () => {
    const apiPositions = (
      overrides: Partial<PositionsByProvider> = {},
      assets: { symbol: string; address?: string }[] = [
        { symbol: 'UNI-V2', address: UNI_V2_USDC_WETH }
      ]
    ): PositionsByProvider => ({
      providerName: 'Uniswap V2',
      chainId: 1n,
      source: 'debank',
      iconUrl: '',
      siteUrl: '',
      type: 'common',
      positions: [
        {
          id: '1',
          additionalData: { name: 'Liquidity Pool' },
          assets: assets.map(({ symbol, address }) => ({
            symbol,
            address,
            name: symbol,
            decimals: 18,
            amount: 1n,
            iconUrl: '',
            type: AssetType.Liquidity
          }))
        }
      ],
      ...overrides
    })

    test('returns the liquidity tokens of the positions, lowercased and once each', () => {
      expect(getUniswapV2PairsFromApiPositions([apiPositions(), apiPositions()], 1n)).toEqual([
        UNI_V2_USDC_WETH.toLowerCase()
      ])
    })
    test('returns only the assets with the symbol of the pairs, so no other token is learned', () => {
      expect(
        getUniswapV2PairsFromApiPositions(
          [
            apiPositions({}, [
              { symbol: 'USDC', address: USDC },
              { symbol: 'WETH', address: WETH },
              { symbol: 'UNI-V2' },
              { symbol: 'UNI-V2', address: 'not-an-address' }
            ])
          ],
          1n
        )
      ).toEqual([])
    })
    test('leaves out the positions of other protocols and networks', () => {
      expect(
        getUniswapV2PairsFromApiPositions(
          [apiPositions({ providerName: 'SushiSwap' }), apiPositions({ chainId: 8453n })],
          1n
        )
      ).toEqual([])
    })
    test('returns nothing on networks without Uniswap V2', () => {
      expect(getUniswapV2PairsFromApiPositions([apiPositions({ chainId: 1337n })], 1337n)).toEqual(
        []
      )
    })
  })

  describe('factories', () => {
    test('has a well-formed address for every network', () => {
      Object.values(UNISWAP_V2_FACTORIES).forEach((factory) => {
        expect(isAddress(factory)).toBe(true)
      })
    })
  })

  describe('reading positions on-chain (Ethereum)', () => {
    const provider = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)
    /** Uniswap's liquidity mining contract for USDC / WETH, which holds the pair's tokens */
    const UNI_STAKING_USDC_WETH = '0x7FBa4B8Dc5E7616e59622806932DBea72537A56b'
    /** SushiSwap's MasterChef, which holds the tokens of SushiSwap's pairs */
    const SUSHI_MASTERCHEF = '0xc2EdaD668740f1aA35E4D8f227fB8E17dcA888Cd'

    test.each([
      ['an RPC that supports state override', false],
      ['an RPC without state override', true]
    ])('finds a pair position among other tokens on %s', async (_, rpcNoStateOverride) => {
      const network: Network = { ...ethereum, rpcNoStateOverride }

      const result = await getUniswapV2Positions(UNI_STAKING_USDC_WETH, provider, network, [
        USDC,
        UNI_V2_USDC_WETH
      ])

      expect(result!.positions.map(({ id }) => id)).toEqual([UNI_V2_USDC_WETH.toLowerCase()])
      expect(result!.positions[0]!.assets.every(({ amount }) => amount > 0n)).toBe(true)
    })
    test('does not read the pairs of other factories, as anyone can deploy a lookalike', async () => {
      expect(
        await getUniswapV2Positions(SUSHI_MASTERCHEF, provider, ethereum, [SUSHI_USDC_WETH])
      ).toBeNull()
    })
  })
})
