import fetch from 'node-fetch'

import { describe } from '@jest/globals'

import { LiFiAPI } from '../lifi/api'
import { SocketAPI } from '../socket/api'
import { SwapProviderParallelExecutor } from './swapProviderParallelExecutor'

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
})
