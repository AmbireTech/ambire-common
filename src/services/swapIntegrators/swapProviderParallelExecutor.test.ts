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
  it('Fetch chains successfully and make sure there are no duplicates', async () => {
    const chainIds = await swapProviderParallelExecutor.getSupportedChains()
    const ids = chainIds.map((item) => item.chainId)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })
  it('Does not return a partial supported chains list when a provider fails', async () => {
    const successfulProvider = {
      id: 'successful',
      name: 'Successful',
      isHealthy: null,
      supportedChains: null,
      updateHealth: jest.fn(),
      resetHealth: jest.fn(),
      getSupportedChains: jest.fn().mockResolvedValue([{ chainId: 1 }]),
      getToTokenList: jest.fn(),
      getToken: jest.fn(),
      startRoute: jest.fn(),
      quote: jest.fn(),
      getRouteStatus: jest.fn()
    } as unknown as SwapProvider
    const failingProvider = {
      id: 'failing',
      name: 'Failing',
      isHealthy: null,
      supportedChains: null,
      updateHealth: jest.fn(),
      resetHealth: jest.fn(),
      getSupportedChains: jest.fn().mockRejectedValue(new Error('provider down')),
      getToTokenList: jest.fn(),
      getToken: jest.fn(),
      startRoute: jest.fn(),
      quote: jest.fn(),
      getRouteStatus: jest.fn()
    } as unknown as SwapProvider

    const executor = new SwapProviderParallelExecutor([successfulProvider, failingProvider])

    await expect(executor.getSupportedChains()).rejects.toThrow(
      'Unable to retrieve the complete list of supported Swap & Bridge chains'
    )
    expect(successfulProvider.getSupportedChains).toHaveBeenCalled()
    expect(failingProvider.getSupportedChains).toHaveBeenCalled()
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
})
