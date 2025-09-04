import { describe } from '@jest/globals'
import fetch from 'node-fetch'
import { LiFiAPI } from '../lifi/api'
import { SocketAPI } from '../socket/api'
import { SwapProviderParallelExecutor } from './swapProviderParallelExecutor'

const socketApi = new SocketAPI({
  apiKey: process.env.SOCKET_API_KEY!,
  fetch
})
const lifiApi = new LiFiAPI({
  apiKey: process.env.LI_FI_API_KEY!,
  fetch
})
const swapProviderParallelExecutor = new SwapProviderParallelExecutor([socketApi, lifiApi])

describe('Swap Provider Parallel execution', () => {
  it('Fetch chains successfully', async () => {
    const chainIds = await swapProviderParallelExecutor.getSupportedChains()
    console.log(chainIds)
  })
})
