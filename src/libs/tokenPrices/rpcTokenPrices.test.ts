import { ZeroAddress } from 'ethers'

import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { RPC_TOKEN_PRICE_CONFIGS } from '../../consts/rpcTokenPrices'
import { Network } from '../../interfaces/network'
import { getRpcProvider } from '../../services/provider'
import * as deployless from '../deployless/deployless'
import { canGetRpcTokenPrices, getRpcTokenPrices, MIN_POOL_DEPTH_USD } from './rpcTokenPrices'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!
const scroll = networks.find(({ chainId }) => chainId === 534352n)!

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const TOKEN_1 = '0x1111111111111111111111111111111111111111'
const TOKEN_2 = '0x2222222222222222222222222222222222222222'
const TOKEN_3 = '0x3333333333333333333333333333333333333333'

describe('getRpcTokenPrices', () => {
  describe('with the contract mocked', () => {
    // $2000, with the 8 decimals of a Chainlink USD feed
    const NATIVE_ANSWER = 2000n * 10n ** 8n
    const provider = {} as any
    // 10 ETH at $2000: well above the liquidity floor
    const DEEP_POOL = 10n * 10n ** 18n
    type MockedRate = {
      rateToNative: bigint
      decimals: number
      poolDepth?: bigint
      isNative?: boolean
    }
    let callSpy: jest.Mock<(...args: any[]) => Promise<any>>

    /**
     * Mocks the contract: the native feed reports `nativeAnswer` updated `feedAgeSeconds` ago, each
     * token gets the rate `rateOf` gives it (in a deep pool, unless it says otherwise), and at most
     * `checkedPerCall` tokens are checked per call.
     */
    const mockContract = ({
      nativeAnswer = NATIVE_ANSWER,
      feedAgeSeconds = 60,
      rateOf = () => ({ rateToNative: 0n, decimals: 18 }),
      checkedPerCall = Infinity
    }: {
      nativeAnswer?: bigint
      feedAgeSeconds?: number
      rateOf?: (token: string) => MockedRate
      checkedPerCall?: number
    } = {}) => {
      callSpy = jest.fn(async (_method: string, [, , tokens]: any[]) => {
        const checkedCount = Math.min(tokens.length, checkedPerCall)
        return [
          {
            answer: nativeAnswer,
            decimals: 8,
            updatedAt: BigInt(Math.floor(Date.now() / 1000) - feedAgeSeconds)
          },
          tokens.map((token: string, index: number) =>
            index < checkedCount
              ? { poolDepth: DEEP_POOL, isNative: false, ...rateOf(token) }
              : { rateToNative: 0n, decimals: 0, poolDepth: 0n, isNative: false }
          ),
          BigInt(checkedCount)
        ]
      })
      jest.spyOn(deployless, 'fromDescriptor').mockReturnValue({ call: callSpy } as any)
    }

    afterEach(() => {
      jest.restoreAllMocks()
    })

    test('prices a token by its rate to the native token and the native price', async () => {
      // 0.0005 ETH per token unit of a 6 decimals token: scaled by 1e18 and by 1e(18 - 6)
      mockContract({ rateOf: () => ({ rateToNative: 5n * 10n ** 26n, decimals: 6 }) })

      const prices = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [USDC]
      })

      expect(prices.get(USDC.toLowerCase())).toBe(1)
    })

    test('prices the native and wrapped native tokens by the feed alone', async () => {
      mockContract()

      const prices = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [ZeroAddress, WETH]
      })

      expect(prices.get(ZeroAddress)).toBe(2000)
      expect(prices.get(WETH.toLowerCase())).toBe(2000)
      // A call with no tokens reads only the native price
      expect(callSpy.mock.calls[0]![1][2]).toEqual([])
    })

    test('gives no price to a token whose most liquid pool is below the liquidity floor', async () => {
      // 1% under the floor's worth of ETH at $2000
      const poolDepth = (BigInt(MIN_POOL_DEPTH_USD) * 10n ** 18n * 99n) / 2000n / 100n
      mockContract({ rateOf: () => ({ rateToNative: 10n ** 15n, decimals: 18, poolDepth }) })

      const prices = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1]
      })

      expect(prices.get(TOKEN_1)).toBeNull()
    })

    test('prices a token whose most liquid pool reaches the liquidity floor', async () => {
      const poolDepth = (BigInt(MIN_POOL_DEPTH_USD) * 10n ** 18n) / 2000n
      mockContract({ rateOf: () => ({ rateToNative: 10n ** 15n, decimals: 18, poolDepth }) })

      const prices = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1]
      })

      expect(prices.get(TOKEN_1)).toBe(2)
    })

    test('prices one of our known tokens even when its pools look shallow', async () => {
      // USDe trades mostly against stablecoins, where the depth comes out far too low
      const USDE = '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3'
      mockContract({
        rateOf: () => ({ rateToNative: 5n * 10n ** 14n, decimals: 18, poolDepth: 0n })
      })

      const prices = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [USDE]
      })

      expect(prices.get(USDE.toLowerCase())).toBe(1)
    })

    test('prices a token that wraps the native token without checking its pools', async () => {
      mockContract({
        rateOf: () => ({ rateToNative: 10n ** 18n, decimals: 18, poolDepth: 0n, isNative: true })
      })

      const prices = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1]
      })

      expect(prices.get(TOKEN_1)).toBe(2000)
    })

    test('reports a token with a rate of 0 as having no price', async () => {
      mockContract()

      const prices = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1]
      })

      expect(prices.get(TOKEN_1)).toBeNull()
    })

    test('asks again for the tokens the contract did not get to before the gas ran low', async () => {
      mockContract({
        rateOf: () => ({ rateToNative: 10n ** 15n, decimals: 18 }),
        checkedPerCall: 2
      })

      const prices = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1, TOKEN_2, TOKEN_3]
      })

      expect(callSpy.mock.calls.map(([, [, , tokens]]) => tokens)).toEqual([
        [TOKEN_1, TOKEN_2, TOKEN_3],
        [TOKEN_3]
      ])
      // 0.001 ETH at $2000
      ;[TOKEN_1, TOKEN_2, TOKEN_3].forEach((token) => expect(prices.get(token)).toBe(2))
    })

    test('throws when not a single token price fits in the gas of a call', async () => {
      mockContract({ checkedPerCall: 0 })

      await expect(
        getRpcTokenPrices({ provider, network: ethereum, tokenAddresses: [TOKEN_1] })
      ).rejects.toThrow(`Not enough gas to read a single token price on ${ethereum.name}`)
    })

    test('throws when the native price is outdated', async () => {
      mockContract({
        feedAgeSeconds: RPC_TOKEN_PRICE_CONFIGS['1']!.nativeUsdFeedMaxAgeSeconds + 60
      })

      await expect(
        getRpcTokenPrices({ provider, network: ethereum, tokenAddresses: [TOKEN_1] })
      ).rejects.toThrow(`The price feed of ${ethereum.name} hasn't been updated recently`)
    })

    test('throws when the feed reports no native price', async () => {
      mockContract({ nativeAnswer: 0n })

      await expect(
        getRpcTokenPrices({ provider, network: ethereum, tokenAddresses: [ZeroAddress] })
      ).rejects.toThrow(`The price feed of ${ethereum.name} reported no price`)
    })

    test('prices only the native token on a network without the price aggregator', async () => {
      mockContract({ rateOf: () => ({ rateToNative: 10n ** 15n, decimals: 18 }) })

      const prices = await getRpcTokenPrices({
        provider,
        network: scroll,
        tokenAddresses: [ZeroAddress, TOKEN_1]
      })

      expect(prices.get(ZeroAddress)).toBe(2000)
      expect(prices.get(TOKEN_1)).toBeNull()
      expect(callSpy.mock.calls.map(([, [, , tokens]]) => tokens)).toEqual([[]])
    })

    test('throws on a network it has no config for', async () => {
      const network: Network = { ...ethereum, chainId: 123456789n, name: 'Unknown' }

      expect(canGetRpcTokenPrices(network)).toBe(false)
      await expect(
        getRpcTokenPrices({ provider, network, tokenAddresses: [TOKEN_1] })
      ).rejects.toThrow("Token prices can't be read from the network on Unknown")
    })
  })

  describe('against the live RPC', () => {
    test('prices the native token, a stablecoin, and no price for an address without pools', async () => {
      const provider = getRpcProvider(ethereum.rpcUrls, ethereum.chainId)
      const DEAD = '0x000000000000000000000000000000000000dEaD'
      const USDE = '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3'

      try {
        const prices = await getRpcTokenPrices({
          provider,
          network: ethereum,
          tokenAddresses: [ZeroAddress, WETH, USDC, USDE, DEAD]
        })

        expect(prices.get(ZeroAddress)).toBeGreaterThan(0)
        expect(prices.get(WETH.toLowerCase())).toBe(prices.get(ZeroAddress))
        expect(prices.get(USDC.toLowerCase())).toBeGreaterThan(0.95)
        expect(prices.get(USDC.toLowerCase())).toBeLessThan(1.05)
        // A known token, priced although its pools (against stablecoins) look shallow
        expect(prices.get(USDE.toLowerCase())).toBeGreaterThan(0.95)
        expect(prices.get(USDE.toLowerCase())).toBeLessThan(1.05)
        expect(prices.get(DEAD.toLowerCase())).toBeNull()
      } finally {
        provider.destroy()
      }
    })

    test('gives no price to scam tokens priced only by a drained pool, unlike real tokens', async () => {
      const baseNetwork = networks.find(({ chainId }) => chainId === 8453n)!
      const provider = getRpcProvider(baseNetwork.rpcUrls, baseNetwork.chainId)
      // Each trades only in a Uniswap v2 pool left with 0.00001 WETH (about $0.02)
      const FORTUNE = '0x1c0c8DF96D723872Df5f84a580b033f6C13F1740'
      const CZ = '0x7F146f07C4247C490f50A09b00aa2F0d6388C90d'
      const AERO = '0x940181a94A35A4569E4529A3CDfB74e38FD98631'

      try {
        const prices = await getRpcTokenPrices({
          provider,
          network: baseNetwork,
          tokenAddresses: [FORTUNE, CZ, AERO]
        })

        expect(prices.get(FORTUNE.toLowerCase())).toBeNull()
        expect(prices.get(CZ.toLowerCase())).toBeNull()
        expect(prices.get(AERO.toLowerCase())).toBeGreaterThan(0)
      } finally {
        provider.destroy()
      }
    })

    test('prices only the native token on Scroll, which has no price aggregator', async () => {
      const provider = getRpcProvider(scroll.rpcUrls, scroll.chainId)
      const SCROLL_USDC = '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4'

      try {
        const prices = await getRpcTokenPrices({
          provider,
          network: scroll,
          tokenAddresses: [ZeroAddress, SCROLL_USDC]
        })

        expect(prices.get(ZeroAddress)).toBeGreaterThan(0)
        expect(prices.get(SCROLL_USDC.toLowerCase())).toBeNull()
      } finally {
        provider.destroy()
      }
    })
  })
})
