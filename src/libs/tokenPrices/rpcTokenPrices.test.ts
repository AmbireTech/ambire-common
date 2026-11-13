import { ZeroAddress } from 'ethers'

import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { STK_WALLET, WALLET_TOKEN } from '../../consts/addresses'
import { networks } from '../../consts/networks'
import { PoolFactoryKind, RPC_TOKEN_PRICE_CONFIGS } from '../../consts/rpcTokenPrices'
import { Network } from '../../interfaces/network'
import { getRpcProvider } from '../../services/provider'
import PriceGetter from '../../../contracts/compiled/PriceGetter.json'
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
      nativeReserve?: bigint
      stableReserve?: bigint
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
              ? {
                  nativeReserve: DEEP_POOL,
                  stableReserve: 0n,
                  isNative: false,
                  ...rateOf(token)
                }
              : {
                  rateToNative: 0n,
                  decimals: 0,
                  nativeReserve: 0n,
                  stableReserve: 0n,
                  isNative: false
                }
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

      const { prices } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [USDC]
      })

      expect(prices.get(USDC.toLowerCase())).toBe(1)
    })

    test('prices the native and wrapped native tokens by the feed alone', async () => {
      mockContract()

      const { prices } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [ZeroAddress, WETH]
      })

      expect(prices.get(ZeroAddress)).toBe(2000)
      expect(prices.get(WETH.toLowerCase())).toBe(2000)
      // A call with no tokens reads only the native price
      expect(callSpy.mock.calls[0]![1][2]).toEqual([])
    })

    test('gives no price to a token whose deepest pool is below the liquidity floor', async () => {
      // 1% under the floor's worth of ETH at $2000
      const nativeReserve = (BigInt(MIN_POOL_DEPTH_USD) * 10n ** 18n * 99n) / 2000n / 100n
      mockContract({ rateOf: () => ({ rateToNative: 10n ** 15n, decimals: 18, nativeReserve }) })

      const { prices } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1]
      })

      expect(prices.get(TOKEN_1)).toBeNull()
    })

    test('prices a token whose deepest pool reaches the liquidity floor', async () => {
      const nativeReserve = (BigInt(MIN_POOL_DEPTH_USD) * 10n ** 18n) / 2000n
      mockContract({ rateOf: () => ({ rateToNative: 10n ** 15n, decimals: 18, nativeReserve }) })

      const { prices } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1]
      })

      expect(prices.get(TOKEN_1)).toBe(2)
    })

    test('prices a token whose pool against a stablecoin reaches the liquidity floor', async () => {
      mockContract({
        rateOf: () => ({
          rateToNative: 10n ** 15n,
          decimals: 18,
          nativeReserve: 0n,
          stableReserve: BigInt(MIN_POOL_DEPTH_USD) * 10n ** 18n
        })
      })

      const { prices } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1]
      })

      expect(prices.get(TOKEN_1)).toBe(2)
    })

    test('gives no price when neither the native nor the stablecoin pool reaches the floor', async () => {
      // Each just under the floor: they aren't added up
      mockContract({
        rateOf: () => ({
          rateToNative: 10n ** 15n,
          decimals: 18,
          nativeReserve: (BigInt(MIN_POOL_DEPTH_USD) * 10n ** 18n * 99n) / 2000n / 100n,
          stableReserve: (BigInt(MIN_POOL_DEPTH_USD) * 10n ** 18n * 99n) / 100n
        })
      })

      const { prices } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1]
      })

      expect(prices.get(TOKEN_1)).toBeNull()
    })

    test("passes the network's pools to look up, with the fees as uint256", async () => {
      mockContract()

      await getRpcTokenPrices({ provider, network: ethereum, tokenAddresses: [TOKEN_1] })

      const poolSearch = callSpy.mock.calls[0]![1][4]
      const { spotPrices } = RPC_TOKEN_PRICE_CONFIGS['1']!
      expect(poolSearch.wrappedNative).toBe(spotPrices!.wrappedNative)
      expect(poolSearch.stablecoins).toEqual(spotPrices!.stablecoins)
      expect(poolSearch.factories).toContainEqual({
        factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
        kind: 1,
        params: [100n, 500n, 3000n, 10000n]
      })
    })

    test('prices one of our fee tokens even when its pools look shallow', async () => {
      // A stablecoin traded mostly against other stablecoins, where the depth comes out too low
      mockContract({
        rateOf: () => ({ rateToNative: 5n * 10n ** 26n, decimals: 6, nativeReserve: 0n })
      })

      const { prices } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [USDC]
      })

      expect(prices.get(USDC.toLowerCase())).toBe(1)
    })

    test('prices a Privacy Pools asset even when its pools look shallow', async () => {
      // USDe trades mostly against stablecoins, where the depth comes out far too low
      const USDE = '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3'
      mockContract({
        rateOf: () => ({ rateToNative: 5n * 10n ** 14n, decimals: 18, nativeReserve: 0n })
      })

      const { prices } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [USDE.toLowerCase()]
      })

      expect(prices.get(USDE.toLowerCase())).toBe(1)
    })

    test('applies the floor to a token on our naming list that is neither curated list', async () => {
      // CHAI: on the humanizer's list of known addresses, which is for naming and isn't kept
      // liquid (CHAI is deprecated)
      const CHAI = '0x06AF07097C9Eeb7fD685c692751D5C66dB49c215'
      mockContract({
        rateOf: () => ({ rateToNative: 5n * 10n ** 14n, decimals: 18, nativeReserve: 0n })
      })

      const { prices } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [CHAI]
      })

      expect(prices.get(CHAI.toLowerCase())).toBeNull()
    })

    test('applies the floor to a Privacy Pools asset on a chain it is not accepted on', async () => {
      const USDE = '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3'
      mockContract({
        rateOf: () => ({ rateToNative: 5n * 10n ** 14n, decimals: 18, nativeReserve: 0n })
      })
      const baseNetwork = networks.find(({ chainId }) => chainId === 8453n)!

      const { prices } = await getRpcTokenPrices({
        provider,
        network: baseNetwork,
        tokenAddresses: [USDE]
      })

      expect(prices.get(USDE.toLowerCase())).toBeNull()
    })

    test('prices a token that wraps the native token without checking its pools', async () => {
      mockContract({
        rateOf: () => ({
          rateToNative: 10n ** 18n,
          decimals: 18,
          nativeReserve: 0n,
          isNative: true
        })
      })

      const { prices } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1]
      })

      expect(prices.get(TOKEN_1)).toBe(2000)
    })

    test('reports a token with a rate of 0 as having no price', async () => {
      mockContract()

      const { prices } = await getRpcTokenPrices({
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

      const { prices } = await getRpcTokenPrices({
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

    test('keeps the prices of the pages that succeed when another page fails', async () => {
      mockContract({ rateOf: () => ({ rateToNative: 10n ** 15n, decimals: 18 }) })
      const pricedCall = callSpy.getMockImplementation()!
      // The second page of 20 tokens fails, e.g. it times out
      callSpy.mockImplementation(async (method: string, args: any[]) => {
        if (args[2].includes(TOKEN_2)) throw new Error('rpc-timeout')
        return pricedCall(method, args)
      })
      const firstPage = Array.from(
        { length: 20 },
        (_, i) => `0x${(i + 16).toString(16).padStart(40, '0')}`
      )

      const { prices, error } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [ZeroAddress, ...firstPage, TOKEN_2]
      })

      expect(error?.message).toBe('rpc-timeout')
      firstPage.forEach((token) => expect(prices.get(token)).toBe(2))
      expect(prices.get(ZeroAddress)).toBe(2000)
      // Left out rather than taken as having no price
      expect(prices.has(TOKEN_2)).toBe(false)
    })

    test('throws when every page fails', async () => {
      mockContract()
      callSpy.mockRejectedValue(new Error('rpc-timeout'))

      await expect(
        getRpcTokenPrices({ provider, network: ethereum, tokenAddresses: [TOKEN_1] })
      ).rejects.toThrow('rpc-timeout')
    })

    test('gives no price, without an error, to a token that needs more gas than the RPC gives a call', async () => {
      mockContract({ rateOf: () => ({ rateToNative: 10n ** 15n, decimals: 18 }) })
      const pricedCall = callSpy.getMockImplementation()!
      // TOKEN_1 needs more gas than the RPC gives a call, so the contract checks nothing
      callSpy.mockImplementation(async (method: string, args: any[]) => {
        const result = await pricedCall(method, args)
        return args[2][0] === TOKEN_1 ? [result[0], result[1], 0n] : result
      })

      const { prices, error } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1, TOKEN_2, TOKEN_3]
      })

      // An error would show a price warning on every update, for a token that will never fit
      expect(error).toBeNull()
      expect(prices.get(TOKEN_1)).toBeNull()
      expect(prices.get(TOKEN_2)).toBe(2)
      expect(prices.get(TOKEN_3)).toBe(2)
    })

    test('keeps what a page read when a follow-up call for the rest of it fails', async () => {
      mockContract({
        rateOf: () => ({ rateToNative: 10n ** 15n, decimals: 18 }),
        checkedPerCall: 2
      })
      const pricedCall = callSpy.getMockImplementation()!
      callSpy.mockImplementation(async (method: string, args: any[]) => {
        // The follow-up call, for the token the first one didn't get to, times out
        if (args[2][0] === TOKEN_3) throw new Error('rpc-timeout')
        return pricedCall(method, args)
      })

      const { prices, error } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1, TOKEN_2, TOKEN_3]
      })

      expect(error?.message).toBe('rpc-timeout')
      expect(prices.get(TOKEN_1)).toBe(2)
      expect(prices.get(TOKEN_2)).toBe(2)
      expect(prices.has(TOKEN_3)).toBe(false)
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

    test('prices stkWALLET with the price of WALLET, which backs it one to one', async () => {
      // 0.0001 ETH per WALLET, so $0.2
      mockContract({
        rateOf: (token) =>
          token === WALLET_TOKEN
            ? { rateToNative: 10n ** 14n, decimals: 18 }
            : { rateToNative: 0n, decimals: 18 }
      })

      const { prices } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [STK_WALLET, WALLET_TOKEN]
      })

      expect(prices.get(STK_WALLET.toLowerCase())).toBe(0.2)
      expect(prices.get(WALLET_TOKEN.toLowerCase())).toBe(0.2)
      // WALLET is asked for once, and stkWALLET, which no pool trades, not at all
      expect(callSpy.mock.calls.map(([, [, , tokens]]) => tokens)).toEqual([[WALLET_TOKEN]])
    })

    test('leaves stkWALLET out, rather than unpriced, when reading WALLET fails', async () => {
      mockContract({
        rateOf: () => ({ rateToNative: 10n ** 15n, decimals: 18 }),
        checkedPerCall: 1
      })
      const pricedCall = callSpy.getMockImplementation()!
      callSpy.mockImplementation(async (method: string, args: any[]) => {
        // The follow-up call, for WALLET, times out
        if (args[2][0] === WALLET_TOKEN) throw new Error('rpc-timeout')
        return pricedCall(method, args)
      })

      const { prices, error } = await getRpcTokenPrices({
        provider,
        network: ethereum,
        tokenAddresses: [TOKEN_1, STK_WALLET]
      })

      expect(error?.message).toBe('rpc-timeout')
      expect(prices.get(TOKEN_1)).toBe(2)
      expect(prices.has(STK_WALLET.toLowerCase())).toBe(false)
    })

    test('prices stkWALLET as itself on a network where it is not mapped', async () => {
      const base = networks.find(({ chainId }) => chainId === 8453n)!
      mockContract({ rateOf: () => ({ rateToNative: 0n, decimals: 18 }) })

      const { prices } = await getRpcTokenPrices({
        provider,
        network: base,
        tokenAddresses: [STK_WALLET]
      })

      expect(prices.get(STK_WALLET.toLowerCase())).toBeNull()
      expect(callSpy.mock.calls.map(([, [, , tokens]]) => tokens)).toEqual([[STK_WALLET]])
    })

    test('prices only the native token on a network without the price aggregator', async () => {
      mockContract({ rateOf: () => ({ rateToNative: 10n ** 15n, decimals: 18 }) })

      const { prices } = await getRpcTokenPrices({
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
        const { prices } = await getRpcTokenPrices({
          provider,
          network: ethereum,
          tokenAddresses: [ZeroAddress, WETH, USDC, USDE, DEAD]
        })

        expect(prices.get(ZeroAddress)).toBeGreaterThan(0)
        expect(prices.get(WETH.toLowerCase())).toBe(prices.get(ZeroAddress))
        expect(prices.get(USDC.toLowerCase())).toBeGreaterThan(0.95)
        expect(prices.get(USDC.toLowerCase())).toBeLessThan(1.05)
        // A Privacy Pools asset, priced although its pools (against stablecoins) look shallow
        expect(prices.get(USDE.toLowerCase())).toBeGreaterThan(0.95)
        expect(prices.get(USDE.toLowerCase())).toBeLessThan(1.05)
        expect(prices.get(DEAD.toLowerCase())).toBeNull()
      } finally {
        provider.destroy()
      }
    })

    test('prices stkWALLET, which no pool trades, the same as WALLET', async () => {
      const provider = getRpcProvider(ethereum.rpcUrls, ethereum.chainId)

      try {
        const { prices } = await getRpcTokenPrices({
          provider,
          network: ethereum,
          tokenAddresses: [STK_WALLET]
        })

        expect(prices.get(STK_WALLET.toLowerCase())).toBeGreaterThan(0)
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
        const { prices } = await getRpcTokenPrices({
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

    test("finds a token's Curve pools and reads what they really hold", async () => {
      // USDe trades mostly on Curve, against USDC and USDT. Only the Curve factories are looked
      // up, so the reserve comes from its Curve pools alone.
      const provider = getRpcProvider(ethereum.rpcUrls, ethereum.chainId)
      const USDE = '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3'

      try {
        const priceGetter = deployless.fromDescriptor(provider, PriceGetter, true)
        const spotPrices = RPC_TOKEN_PRICE_CONFIGS['1']!.spotPrices!
        type Factories = typeof spotPrices.poolFactories
        const toSearch = (factories: Factories) => ({
          wrappedNative: spotPrices.wrappedNative,
          stablecoins: spotPrices.stablecoins,
          factories: factories.map(({ factory, kind, params }) => ({
            factory,
            kind,
            params: params.map(BigInt)
          }))
        })
        const readStableReserve = async (factories: Factories) => {
          const [, rates] = await priceGetter.call('getPrices', [
            RPC_TOKEN_PRICE_CONFIGS['1']!.nativeUsdFeed,
            spotPrices.oracle,
            [USDE],
            10n,
            toSearch(factories)
          ])
          return rates[0].stableReserve as bigint
        }
        const curveFactories = spotPrices.poolFactories.filter(
          ({ kind }) => kind === PoolFactoryKind.Curve
        )

        // USDe's USDC and USDT pools on Curve hold far more than the floor
        expect(await readStableReserve(curveFactories)).toBeGreaterThan(
          BigInt(MIN_POOL_DEPTH_USD) * 10n ** 18n
        )
      } finally {
        provider.destroy()
      }
    })

    test('gives no price to a fake WALLET whose only pool is a narrow position with a few dollars', async () => {
      const provider = getRpcProvider(ethereum.rpcUrls, ethereum.chainId)
      // Its only pool, a Uniswap v3 one, holds about 0.004 WETH, but its in-range liquidity
      // weighs as much as a pool with over 1.6 ETH
      const FAKE_WALLET = '0xd2f34c7e9732b88086f186758eb732f91388ed45'
      const WALLET = '0x88800092fF476844f74dC2FC427974BBee2794Ae'
      const UNI = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'

      try {
        const { prices } = await getRpcTokenPrices({
          provider,
          network: ethereum,
          tokenAddresses: [FAKE_WALLET, WALLET, UNI]
        })

        expect(prices.get(FAKE_WALLET)).toBeNull()
        expect(prices.get(WALLET.toLowerCase())).toBeGreaterThan(0)
        expect(prices.get(UNI.toLowerCase())).toBeGreaterThan(0)
      } finally {
        provider.destroy()
      }
    })

    test('the contract still prices tokens in a call capped well below the per-token limit', async () => {
      const provider = getRpcProvider(ethereum.rpcUrls, ethereum.chainId)
      const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'

      try {
        const priceGetter = deployless.fromDescriptor(provider, PriceGetter, true)
        const [, rates, checkedCount] = await priceGetter.call(
          'getPrices',
          [
            RPC_TOKEN_PRICE_CONFIGS['1']!.nativeUsdFeed,
            RPC_TOKEN_PRICE_CONFIGS['1']!.spotPrices!.oracle,
            [DAI, USDC],
            10n,
            { wrappedNative: WETH, stablecoins: [], factories: [] }
          ],
          // An RPC that gives a call 12M gas, less than the 15M a single token is allowed
          { gasLimit: '0xb71b00' }
        )

        expect(Number(checkedCount)).toBeGreaterThan(0)
        expect(rates[0].rateToNative).toBeGreaterThan(0n)
      } finally {
        provider.destroy()
      }
    })

    test('prices only the native token on Scroll, which has no price aggregator', async () => {
      const provider = getRpcProvider(scroll.rpcUrls, scroll.chainId)
      const SCROLL_USDC = '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4'

      try {
        const { prices } = await getRpcTokenPrices({
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
