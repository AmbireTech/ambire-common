import { Wallet, ZeroAddress } from 'ethers'
import { isAddress } from 'viem'

import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../../../consts/networks'
import { Network } from '../../../../interfaces/network'
import { getRpcProvider } from '../../../../services/provider'
import { Deployless } from '../../../deployless/deployless'
import { AssetType } from '../../types'
import { UNISWAP_V4 } from './addresses'
import {
  getUniswapV4Position,
  getUniswapV4Positions,
  UNISWAP_V4_PROVIDER_NAME,
  UniswapV4PositionResult
} from './uniswapV4'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!
const ETHEREUM_POSITION_MANAGER = UNISWAP_V4['1']!.positionManagerAddr
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const POOL_ID = '0x1111111111111111111111111111111111111111111111111111111111111111'

const tokenInfo = (symbol: string) => ({ symbol, name: symbol, decimals: 6, hasDecimals: true })
const emptyTokenInfo = { symbol: '', name: '', decimals: 0, hasDecimals: false }

// A USDC / USDT position at a price of 1 (tick 0), in range
const positionResult = (
  overrides: Partial<UniswapV4PositionResult> = {}
): UniswapV4PositionResult => ({
  tokenId: 42n,
  poolKey: { currency0: USDC, currency1: USDT },
  poolId: POOL_ID,
  tickLower: -600,
  tickUpper: 600,
  liquidity: 10n ** 12n,
  sqrtPriceX96: 2n ** 96n,
  token0: tokenInfo('USDC'),
  token1: tokenInfo('USDT'),
  ...overrides
})

describe('Uniswap v4 positions', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('getUniswapV4Position', () => {
    test('a position in range holds both tokens', () => {
      const position = getUniswapV4Position(positionResult(), ethereum)!

      expect(position.additionalData.inRange).toBe(true)
      expect(position.assets.map(({ symbol, type }) => [symbol, type])).toEqual([
        ['USDC', AssetType.Liquidity],
        ['USDT', AssetType.Liquidity]
      ])
      expect(position.assets.every(({ amount }) => amount > 0n)).toBe(true)
    })
    test('a position out of range holds one token only', () => {
      const position = getUniswapV4Position(
        positionResult({ tickLower: 600, tickUpper: 1200 }),
        ethereum
      )!

      expect(position.additionalData.inRange).toBe(false)
      expect(position.assets[0]!.amount).toBeGreaterThan(0n)
      expect(position.assets[1]!.amount).toBe(0n)
    })
    test('is identified by its token id and has its pool', () => {
      const position = getUniswapV4Position(positionResult(), ethereum)!

      expect(position.id).toBe('42')
      expect(position.additionalData.positionIndex).toBe('42')
      expect(position.additionalData.name).toBe('Liquidity Pool')
      expect(position.additionalData.pool).toEqual({ id: POOL_ID })
    })
    test('the native token of the network is named after the network', () => {
      const position = getUniswapV4Position(
        positionResult({
          poolKey: { currency0: ZeroAddress, currency1: USDC },
          token0: emptyTokenInfo,
          token1: tokenInfo('USDC')
        }),
        ethereum
      )!

      expect(position.assets[0]).toMatchObject({
        address: ZeroAddress,
        symbol: ethereum.nativeAssetSymbol,
        name: ethereum.nativeAssetName,
        decimals: 18
      })
    })
    test('is not displayed when a token did not return its decimals', () => {
      expect(getUniswapV4Position(positionResult({ token1: emptyTokenInfo }), ethereum)).toBeNull()
    })
  })

  describe('getUniswapV4Positions', () => {
    const provider = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)
    const account = Wallet.createRandom().address

    test('reads the NFTs of the account, once each', async () => {
      const callSpy = jest.spyOn(Deployless.prototype, 'call').mockResolvedValue([positionResult()])

      const result = await getUniswapV4Positions(account, provider, ethereum, {
        [ETHEREUM_POSITION_MANAGER.toLowerCase()]: [42n, 42n, 7n]
      })

      expect(callSpy).toHaveBeenCalledWith('getUniswapV4Positions', [
        account,
        ETHEREUM_POSITION_MANAGER,
        UNISWAP_V4['1']!.stateViewAddr,
        [42n, 7n]
      ])
      expect(result!.providerName).toBe(UNISWAP_V4_PROVIDER_NAME)
      expect(result!.source).toBe('custom')
      expect(result!.positions.map(({ id }) => id)).toEqual(['42'])
    })
    test('splits many NFTs into calls of 50, so a call stays below the limits of the RPC', async () => {
      const callSpy = jest
        .spyOn(Deployless.prototype, 'call')
        .mockImplementation(async (_methodName: string, args: any[]) =>
          (args[3] as bigint[]).map((tokenId) => positionResult({ tokenId }))
        )
      const tokenIds = Array.from({ length: 120 }, (_, index) => BigInt(index + 1))

      const result = await getUniswapV4Positions(account, provider, ethereum, {
        [ETHEREUM_POSITION_MANAGER.toLowerCase()]: tokenIds
      })

      expect(callSpy.mock.calls.map(([, args]) => (args[3] as bigint[]).length)).toEqual([
        50, 50, 20
      ])
      expect(result!.positions).toHaveLength(120)
    })
    test('reads nothing when the account holds no positions', async () => {
      const callSpy = jest.spyOn(Deployless.prototype, 'call')

      expect(
        await getUniswapV4Positions(account, provider, ethereum, {
          '0x0000000000000000000000000000000000000001': [1n]
        })
      ).toBeNull()
      expect(callSpy).not.toHaveBeenCalled()
    })
    test('reads nothing on networks without Uniswap v4', async () => {
      const callSpy = jest.spyOn(Deployless.prototype, 'call')
      const networkWithoutUniswapV4: Network = { ...ethereum, chainId: 1337n }

      expect(
        await getUniswapV4Positions(account, provider, networkWithoutUniswapV4, {
          [ETHEREUM_POSITION_MANAGER.toLowerCase()]: [42n]
        })
      ).toBeNull()
      expect(callSpy).not.toHaveBeenCalled()
    })
    test('returns null when none of the positions are held anymore', async () => {
      jest.spyOn(Deployless.prototype, 'call').mockResolvedValue([])

      expect(
        await getUniswapV4Positions(account, provider, ethereum, {
          [ETHEREUM_POSITION_MANAGER.toLowerCase()]: [42n]
        })
      ).toBeNull()
    })
  })

  describe('addresses', () => {
    test('has well-formed addresses for every network', () => {
      Object.values(UNISWAP_V4).forEach(({ positionManagerAddr, stateViewAddr }) => {
        expect(isAddress(positionManagerAddr)).toBe(true)
        expect(isAddress(stateViewAddr)).toBe(true)
      })
    })
  })

  // Reads real positions that belong to other accounts, so a change of the contracts' interface
  // fails these tests
  describe('reading positions on-chain (Ethereum)', () => {
    const provider = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)

    test.each([
      ['an RPC that supports state override', false],
      ['an RPC without state override', true]
    ])('skips the positions the account does not own on %s', async (_, rpcNoStateOverride) => {
      const network: Network = { ...ethereum, rpcNoStateOverride }

      expect(
        await getUniswapV4Positions(Wallet.createRandom().address, provider, network, {
          // Includes an id that doesn't exist yet, for which `ownerOf` reverts
          [ETHEREUM_POSITION_MANAGER.toLowerCase()]: [1n, 2n, 3n, 10n ** 12n]
        })
      ).toBeNull()
    })
  })
})
