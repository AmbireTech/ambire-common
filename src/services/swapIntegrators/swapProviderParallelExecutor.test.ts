import fetch from 'node-fetch'

import { describe } from '@jest/globals'

import { LiFiAPI } from '../lifi/api'
import { SocketAPI } from '../socket/api'
import { SwapProviderParallelExecutor } from './swapProviderParallelExecutor'
import { SwapProvider } from '../../interfaces/swapAndBridge'

const socketApi = new SocketAPI({ fetch, apiKey: '' })
const lifiApi = new LiFiAPI({ fetch, apiKey: '' })
const swapProviderParallelExecutor = new SwapProviderParallelExecutor([socketApi, lifiApi])

describe('Swap Provider Parallel execution', () => {
  const createProvider = (getSupportedChains: SwapProvider['getSupportedChains']) =>
    ({
      id: 'test-provider',
      name: 'Test Provider',
      isHealthy: null,
      supportedChains: null,
      updateHealth: jest.fn(),
      resetHealth: jest.fn(),
      getSupportedChains,
      getToTokenList: jest.fn(),
      getToken: jest.fn(),
      startRoute: jest.fn(),
      quote: jest.fn(),
      getRouteStatus: jest.fn()
    } as unknown as SwapProvider)

  it('Fetch chains successfully and make sure there are no duplicates', async () => {
    const chainIds = await swapProviderParallelExecutor.getSupportedChains()
    const ids = chainIds.map((item) => item.chainId)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('Falls back to active networks when supported chains are fewer than 10', async () => {
    const provider = createProvider(async () => [{ chainId: 1 }])
    const fallbackSupportedChains = [{ chainId: 1 }, { chainId: 10 }, { chainId: 137 }]
    const executor = new SwapProviderParallelExecutor([provider], () => fallbackSupportedChains)

    await expect(executor.getSupportedChains()).resolves.toEqual(fallbackSupportedChains)
  })

  it('Times out supported chains requests after 10 seconds', async () => {
    jest.useFakeTimers()

    try {
      const provider = createProvider(() => new Promise(() => {}))
      const fallbackSupportedChains = [{ chainId: 1 }]
      const executor = new SwapProviderParallelExecutor([provider], () => fallbackSupportedChains)
      const supportedChainsPromise = executor.getSupportedChains()

      await jest.advanceTimersByTimeAsync(10000)
      await expect(supportedChainsPromise).resolves.toEqual(fallbackSupportedChains)
    } finally {
      jest.useRealTimers()
    }
  })

  it('Fetch to token list successfully and make sure there are no duplicate tokens', async () => {
    const toTokenList = await swapProviderParallelExecutor.getToTokenList({
      fromChainId: 10,
      toChainId: 10
    })
    const ids = toTokenList.map((item) => `${item.chainId}-${item.address}`)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })
  it('Fetch to token successfully', async () => {
    const toToken = await swapProviderParallelExecutor.getToken({
      address: '0x4200000000000000000000000000000000000042',
      chainId: 10
    })
    expect(toToken).not.toBe(null)
  })

  it('Uses provider-specific chain support checks when available', async () => {
    const partialProvider = {
      id: 'partial',
      name: 'Partial',
      isHealthy: null,
      supportedChains: [{ chainId: 4114 }],
      updateHealth: jest.fn(),
      resetHealth: jest.fn(),
      areChainsSupported: ({
        fromChainId,
        toChainId
      }: {
        fromChainId: number
        toChainId: number
      }) => fromChainId === 4114 || toChainId === 4114,
      getSupportedChains: jest.fn(),
      getToTokenList: jest.fn().mockResolvedValue([
        {
          address: '0x0000000000000000000000000000000000000000',
          chainId: 1,
          decimals: 18,
          name: 'Ether',
          symbol: 'ETH'
        }
      ]),
      getToken: jest.fn(),
      startRoute: jest.fn(),
      quote: jest.fn(),
      getRouteStatus: jest.fn()
    } as unknown as SwapProvider

    const executor = new SwapProviderParallelExecutor([partialProvider])
    await executor.getToTokenList({ fromChainId: 4114, toChainId: 1 })

    expect(partialProvider.getToTokenList).toHaveBeenCalled()
  })

  it('Does not call providers that explicitly do not support a route pair', async () => {
    const socketProvider = {
      id: 'socket',
      name: 'Socket',
      isHealthy: null,
      supportedChains: null,
      updateHealth: jest.fn(),
      resetHealth: jest.fn(),
      areChainsSupported: jest.fn(({ fromChainId, toChainId }) => {
        return fromChainId !== 4114 && toChainId !== 4114
      }),
      getSupportedChains: jest.fn(),
      getToTokenList: jest.fn(),
      getToken: jest.fn(),
      startRoute: jest.fn(),
      quote: jest.fn(),
      getRouteStatus: jest.fn()
    } as unknown as SwapProvider
    const squidProvider = {
      id: 'squid',
      name: 'Squid',
      isHealthy: null,
      supportedChains: [{ chainId: 4114 }],
      updateHealth: jest.fn(),
      resetHealth: jest.fn(),
      areChainsSupported: jest.fn(({ fromChainId, toChainId }) => {
        return fromChainId === 4114 || toChainId === 4114
      }),
      getSupportedChains: jest.fn(),
      getToTokenList: jest.fn(),
      getToken: jest.fn(),
      startRoute: jest.fn(),
      quote: jest.fn().mockResolvedValue({
        fromAsset: {
          address: '0x0000000000000000000000000000000000000000',
          chainId: 137,
          decimals: 18,
          name: 'POL',
          symbol: 'POL'
        },
        fromChainId: 137,
        toAsset: {
          address: '0x0000000000000000000000000000000000000000',
          chainId: 4114,
          decimals: 18,
          name: 'cBTC',
          symbol: 'cBTC'
        },
        toChainId: 4114,
        selectedRouteSteps: [],
        routes: []
      }),
      getRouteStatus: jest.fn()
    } as unknown as SwapProvider

    const executor = new SwapProviderParallelExecutor([socketProvider, squidProvider])
    await executor.quote({
      fromAsset: {
        address: '0x0000000000000000000000000000000000000000',
        chainId: 137n,
        decimals: 18,
        name: 'POL',
        symbol: 'POL'
      } as any,
      fromChainId: 137,
      fromTokenAddress: '0x0000000000000000000000000000000000000000',
      toAsset: {
        address: '0x0000000000000000000000000000000000000000',
        chainId: 4114,
        decimals: 18,
        name: 'cBTC',
        symbol: 'cBTC'
      },
      toChainId: 4114,
      toTokenAddress: '0x0000000000000000000000000000000000000000',
      fromAmount: 1n,
      userAddress: '0x0000000000000000000000000000000000000001',
      accountNativeBalance: 1n,
      isWrapOrUnwrap: false,
      nativeSymbol: 'POL',
      sort: 'output'
    })

    expect(socketProvider.quote).not.toHaveBeenCalled()
    expect(squidProvider.quote).toHaveBeenCalled()
  })

  it('Returns routes from all providers that complete within the wait window', async () => {
    const makeProvider = (id: string, delayMs: number) =>
      ({
        id,
        name: id,
        isHealthy: null,
        supportedChains: null,
        updateHealth: jest.fn(),
        resetHealth: jest.fn(),
        getSupportedChains: jest.fn(),
        getToTokenList: jest.fn(),
        getToken: jest.fn(),
        startRoute: jest.fn(),
        quote: jest.fn(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () =>
                  resolve({
                    fromAsset: {
                      address: '0x0000000000000000000000000000000000000000',
                      chainId: 1,
                      decimals: 18,
                      name: 'Ether',
                      symbol: 'ETH'
                    },
                    fromChainId: 1,
                    toAsset: {
                      address: '0x0000000000000000000000000000000000000000',
                      chainId: 1,
                      decimals: 18,
                      name: 'Ether',
                      symbol: 'ETH'
                    },
                    toChainId: 1,
                    selectedRouteSteps: [],
                    routes: [
                      {
                        providerId: id,
                        routeId: id,
                        fromAmount: '1',
                        toAmount: '1'
                      }
                    ]
                  }),
                delayMs
              )
            })
        ),
        getRouteStatus: jest.fn()
      }) as unknown as SwapProvider

    const executor = new SwapProviderParallelExecutor([
      makeProvider('lifi', 1),
      makeProvider('socket', 5),
      makeProvider('uniswap', 10)
    ])

    const quote = await executor.quote({
      fromAsset: {
        address: '0x0000000000000000000000000000000000000000',
        chainId: 1n,
        decimals: 18,
        name: 'ETH',
        symbol: 'ETH'
      } as any,
      fromChainId: 1,
      fromTokenAddress: '0x0000000000000000000000000000000000000000',
      toAsset: {
        address: '0x0000000000000000000000000000000000000000',
        chainId: 1,
        decimals: 18,
        name: 'ETH',
        symbol: 'ETH'
      },
      toChainId: 1,
      toTokenAddress: '0x0000000000000000000000000000000000000000',
      fromAmount: 1n,
      userAddress: '0x0000000000000000000000000000000000000001',
      accountNativeBalance: 1n,
      isWrapOrUnwrap: false,
      nativeSymbol: 'ETH',
      sort: 'output'
    })

    expect(quote.routes.map((route) => route.providerId).sort()).toEqual([
      'lifi',
      'socket',
      'uniswap'
    ])
  })
})
