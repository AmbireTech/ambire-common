import { afterEach, describe, expect, jest, test } from '@jest/globals'
import { createSagaLogSource } from '@kohaku-eth/privacy-pools'
import type { EthereumProvider, TxLog } from '@kohaku-eth/provider'

import { PRIVACY_POOLS_SAGA_READ_TIMEOUT } from '../../consts/privacyPools'
import { createPrivacyPoolsDataService } from './dataService'

/** Keeps the log source each data service is built with, so a test can read through it. */
jest.mock('@kohaku-eth/privacy-pools', () => ({
  createSagaLogSource: jest.fn(),
  DataService: class {
    getLogs: unknown

    constructor({ getLogs }: { getLogs: unknown }) {
      this.getLogs = getLogs
    }
  }
}))

const POOL_ADDRESS = '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb'
const RPC_LOG: TxLog = { blockNumber: 1n, topics: [], data: '0x', address: POOL_ADDRESS }
const LOGS_PARAMS = { address: POOL_ADDRESS, fromBlock: 0n, toBlock: 0n }

/** A CDN read that was accepted and never answers. */
const hang = () => new Promise<never>(() => {})

const createService = (getProviderLogs = jest.fn(async () => [RPC_LOG])) => {
  const provider = {
    getLogs: getProviderLogs,
    getBlockNumber: async () => 0n
  } as unknown as EthereumProvider
  const onSagaUnavailable = jest.fn()
  const servicePromise = createPrivacyPoolsDataService({
    provider,
    saga: { sourceUrl: 'https://saga.example/v2', chainId: 1n },
    onSagaUnavailable
  })

  return { servicePromise, onSagaUnavailable }
}

const getLogsOf = (dataService: unknown) =>
  (dataService as { getLogs: (params: typeof LOGS_PARAMS) => Promise<TxLog[]> }).getLogs

describe('createPrivacyPoolsDataService', () => {
  afterEach(() => jest.useRealTimers())

  test('reads from the provider when the CDN manifest gets no answer', async () => {
    jest.useFakeTimers()
    jest.mocked(createSagaLogSource).mockImplementation(hang)
    const { servicePromise, onSagaUnavailable } = createService()

    await jest.advanceTimersByTimeAsync(PRIVACY_POOLS_SAGA_READ_TIMEOUT)
    const { dataService, isSagaHydrated } = await servicePromise

    expect(isSagaHydrated).toBe(false)
    expect(onSagaUnavailable).toHaveBeenCalledTimes(1)
    await expect(getLogsOf(dataService)(LOGS_PARAMS)).resolves.toEqual([RPC_LOG])
  })

  test('moves to the provider for good once a CDN read gets no answer', async () => {
    jest.useFakeTimers()
    const sagaLogs = jest.fn(hang)
    jest.mocked(createSagaLogSource).mockResolvedValue(sagaLogs as any)
    const { servicePromise, onSagaUnavailable } = createService()
    const getLogs = getLogsOf((await servicePromise).dataService)

    const reading = getLogs(LOGS_PARAMS)
    await jest.advanceTimersByTimeAsync(PRIVACY_POOLS_SAGA_READ_TIMEOUT)

    await expect(reading).resolves.toEqual([RPC_LOG])
    await expect(getLogs(LOGS_PARAMS)).resolves.toEqual([RPC_LOG])
    expect(sagaLogs).toHaveBeenCalledTimes(1)
    expect(onSagaUnavailable).toHaveBeenCalledTimes(1)
  })

  test('stays on the CDN when the provider fails on the blocks the CDN has not indexed', async () => {
    jest.useFakeTimers()
    const rpcError = new Error('RPC unavailable')
    let failuresLeft = 4
    const getProviderLogs = jest.fn(async () => {
      if (failuresLeft > 0) {
        failuresLeft -= 1
        throw rpcError
      }
      return [RPC_LOG]
    })
    // Like the SDK's reader, it hands the newest blocks to the provider
    const sagaLogs = jest.fn()
    jest.mocked(createSagaLogSource).mockImplementation(async ({ fallback }) => {
      sagaLogs.mockImplementation((params) => fallback(params as typeof LOGS_PARAMS))
      return sagaLogs as any
    })
    const { servicePromise, onSagaUnavailable } = createService(getProviderLogs)
    const getLogs = getLogsOf((await servicePromise).dataService)

    const reading = getLogs(LOGS_PARAMS)
    const failed = expect(reading).rejects.toBe(rpcError)
    await jest.advanceTimersByTimeAsync(PRIVACY_POOLS_SAGA_READ_TIMEOUT / 2)
    await failed

    await expect(getLogs(LOGS_PARAMS)).resolves.toEqual([RPC_LOG])
    expect(sagaLogs).toHaveBeenCalledTimes(2)
    expect(onSagaUnavailable).not.toHaveBeenCalled()
  })
})
