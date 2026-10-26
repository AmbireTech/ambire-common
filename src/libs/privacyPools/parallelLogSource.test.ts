import { describe, expect, jest, test } from '@jest/globals'
import type { EthereumProvider, TxLog } from '@kohaku-eth/provider'

import { createParallelLogSource } from './parallelLogSource'

const POOL_ADDRESS = '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb'

const createProvider = () => {
  const getLogs = jest.fn(
    async ({ fromBlock }: { fromBlock?: unknown }): Promise<TxLog[]> => [
      { blockNumber: BigInt(fromBlock as bigint), topics: [], data: '0x', address: POOL_ADDRESS }
    ]
  )
  const provider = { getLogs, getBlockNumber: async () => 0n } as unknown as EthereumProvider

  return { provider, getLogs }
}

describe('createParallelLogSource', () => {
  test('reads every window for a hex address, in block order', async () => {
    const { provider, getLogs } = createProvider()
    const getPoolLogs = createParallelLogSource({ provider })

    const logs = await getPoolLogs({
      address: POOL_ADDRESS,
      fromBlock: 0n,
      toBlock: 29n,
      maxQuerySize: 10n
    })

    expect(logs.map((log) => log.blockNumber)).toEqual([0n, 10n, 20n])
    expect(getLogs).toHaveBeenCalledWith({ address: POOL_ADDRESS, fromBlock: 20n, toBlock: 29n })
  })

  test('refuses an address that is not hex, before reaching the provider', async () => {
    const { provider, getLogs } = createProvider()
    const getPoolLogs = createParallelLogSource({ provider })

    await expect(getPoolLogs({ address: 'pool', fromBlock: 0n, toBlock: 9n })).rejects.toThrow(
      'not a hex address'
    )
    expect(getLogs).not.toHaveBeenCalled()
  })
})
