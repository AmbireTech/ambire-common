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
    }) as unknown as SwapProvider

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

  it('Returns provider information without exposing the private providers list', () => {
    const provider = createProvider(async () => [])
    const executor = new SwapProviderParallelExecutor([provider])

    expect(executor.getProvidersInfo()).toEqual([{ id: 'test-provider', name: 'Test Provider' }])
  })

  it('Does not fetch from disabled providers', async () => {
    const disabledProvider = createProvider(async () => [])
    disabledProvider.getToTokenList = jest.fn().mockResolvedValue([])
    const enabledProvider = {
      ...createProvider(async () => []),
      id: 'enabled-provider',
      getToTokenList: jest.fn().mockResolvedValue([
        {
          address: '0x0000000000000000000000000000000000000000',
          chainId: 1,
          decimals: 18,
          name: 'Ether',
          symbol: 'ETH'
        }
      ])
    } as SwapProvider
    const executor = new SwapProviderParallelExecutor(
      [disabledProvider, enabledProvider],
      undefined,
      () => [disabledProvider.id]
    )

    await expect(executor.getToTokenList({ fromChainId: 1, toChainId: 1 })).resolves.toEqual([
      expect.objectContaining({ name: 'Ether' })
    ])
    expect(disabledProvider.getToTokenList).not.toHaveBeenCalled()
    expect(enabledProvider.getToTokenList).toHaveBeenCalled()
  })

  it('Returns no supported chains when all providers are disabled', async () => {
    const provider = createProvider(async () => [{ chainId: 1 }])
    provider.getSupportedChains = jest.fn().mockResolvedValue([{ chainId: 1 }])
    const fallbackSupportedChains = jest.fn(() => [{ chainId: 1 }])
    const executor = new SwapProviderParallelExecutor([provider], fallbackSupportedChains, () => [
      provider.id
    ])

    await expect(executor.getSupportedChains()).resolves.toEqual([])
    expect(provider.getSupportedChains).not.toHaveBeenCalled()
    expect(fallbackSupportedChains).not.toHaveBeenCalled()
  })

  it('Gets supported chains only from enabled providers', async () => {
    const disabledProvider = createProvider(async () => [{ chainId: 1 }])
    disabledProvider.getSupportedChains = jest.fn().mockResolvedValue([{ chainId: 1 }])
    const enabledProvider = {
      ...createProvider(async () => [{ chainId: 10 }]),
      id: 'enabled-provider',
      getSupportedChains: jest.fn().mockResolvedValue([{ chainId: 10 }])
    } as SwapProvider
    const fallbackSupportedChains = jest.fn(() => [{ chainId: 1 }, { chainId: 10 }])
    const executor = new SwapProviderParallelExecutor(
      [disabledProvider, enabledProvider],
      fallbackSupportedChains,
      () => [disabledProvider.id]
    )

    await expect(executor.getSupportedChains()).resolves.toEqual([{ chainId: 10 }])
    expect(disabledProvider.getSupportedChains).not.toHaveBeenCalled()
    expect(enabledProvider.getSupportedChains).toHaveBeenCalled()
    expect(fallbackSupportedChains).not.toHaveBeenCalled()
  })

  it('Routes existing operations to a disabled provider', async () => {
    const provider = createProvider(async () => [])
    provider.startRoute = jest.fn().mockResolvedValue({ activeRouteId: 'active-route-id' })
    const executor = new SwapProviderParallelExecutor([provider], undefined, () => [provider.id])

    await expect(executor.startRoute({ providerId: provider.id } as any)).resolves.toEqual({
      activeRouteId: 'active-route-id'
    })
    expect(provider.startRoute).toHaveBeenCalled()
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

  it('Requests every provider once and reports token lists as providers complete', async () => {
    const createToken = (address: string, symbol: string) => ({
      address,
      chainId: 1,
      decimals: 18,
      name: symbol,
      symbol
    })
    const firstToken = createToken('0x0000000000000000000000000000000000000001', 'FIRST')
    const secondToken = createToken('0x0000000000000000000000000000000000000002', 'SECOND')
    let resolveFirstProvider!: (tokens: (typeof firstToken)[]) => void
    let resolveSecondProvider!: (tokens: (typeof firstToken)[]) => void
    const firstProvider = createProvider(async () => [])
    const secondProvider = createProvider(async () => [])
    firstProvider.getToTokenList = jest.fn(
      () => new Promise<(typeof firstToken)[]>((resolve) => (resolveFirstProvider = resolve))
    )
    secondProvider.getToTokenList = jest.fn(
      () => new Promise<(typeof firstToken)[]>((resolve) => (resolveSecondProvider = resolve))
    )
    let resolveFirstUpdate!: () => void
    const firstUpdatePromise = new Promise<void>((resolve) => (resolveFirstUpdate = resolve))
    const onUpdate = jest.fn(resolveFirstUpdate)
    const executor = new SwapProviderParallelExecutor([firstProvider, secondProvider])

    const tokenListPromise = executor.getToTokenList({
      fromChainId: 1,
      toChainId: 1,
      onUpdate
    })

    expect(firstProvider.getToTokenList).toHaveBeenCalledTimes(1)
    expect(secondProvider.getToTokenList).toHaveBeenCalledTimes(1)

    resolveSecondProvider([secondToken])
    await firstUpdatePromise
    expect(onUpdate).toHaveBeenLastCalledWith([secondToken])

    resolveFirstProvider([firstToken, secondToken])
    await expect(tokenListPromise).resolves.toEqual([secondToken, firstToken])
    expect(onUpdate).toHaveBeenLastCalledWith([secondToken, firstToken])
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })

  it('Keeps successful token results when another provider times out', async () => {
    jest.useFakeTimers()

    try {
      const token = {
        address: '0x0000000000000000000000000000000000000001',
        chainId: 1,
        decimals: 18,
        name: 'Token',
        symbol: 'TOKEN'
      }
      const successfulProvider = createProvider(async () => [])
      const hangingProvider = createProvider(async () => [])
      successfulProvider.getToTokenList = jest.fn(async () => [token])
      hangingProvider.getToTokenList = jest.fn(() => new Promise(() => {}))
      let resolveUpdate!: () => void
      const updatePromise = new Promise<void>((resolve) => (resolveUpdate = resolve))
      const onUpdate = jest.fn(resolveUpdate)
      const executor = new SwapProviderParallelExecutor([successfulProvider, hangingProvider])
      const tokenListPromise = executor.getToTokenList({
        fromChainId: 1,
        toChainId: 1,
        onUpdate
      })

      await updatePromise
      expect(onUpdate).toHaveBeenCalledWith([token])

      await jest.advanceTimersByTimeAsync(30000)
      await expect(tokenListPromise).resolves.toEqual([token])
      expect(successfulProvider.getToTokenList).toHaveBeenCalledTimes(1)
      expect(hangingProvider.getToTokenList).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('Fails after all providers fail or time out without retrying them automatically', async () => {
    jest.useFakeTimers()

    try {
      const failingProvider = createProvider(async () => [])
      const hangingProvider = createProvider(async () => [])
      failingProvider.getToTokenList = jest.fn(async () => {
        throw new Error('Provider failed')
      })
      hangingProvider.getToTokenList = jest.fn(() => new Promise(() => {}))
      const executor = new SwapProviderParallelExecutor([failingProvider, hangingProvider])
      const tokenListPromise = executor.getToTokenList({ fromChainId: 1, toChainId: 1 })
      const expectedFailure = expect(tokenListPromise).rejects.toThrow(
        'Our service providers are currently unavailable. Please try again later.'
      )

      await jest.advanceTimersByTimeAsync(30000)
      await expectedFailure
      expect(failingProvider.getToTokenList).toHaveBeenCalledTimes(1)
      expect(hangingProvider.getToTokenList).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
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
    const citreaProvider = {
      id: 'citrea-provider',
      name: 'Citrea Provider',
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

    const executor = new SwapProviderParallelExecutor([socketProvider, citreaProvider])
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
    expect(citreaProvider.quote).toHaveBeenCalled()
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
