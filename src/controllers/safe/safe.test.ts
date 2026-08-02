import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { getAddress } from 'ethers'

import { SafeAccountByOwner } from '../../interfaces/safe'
import { getApiKit, getSafeAccountByOwner } from '../../libs/safe/safe'
import { SafeController } from './safe'

jest.mock('../../libs/safe/safe', () => ({
  ...jest.requireActual('../../libs/safe/safe'),
  getApiKit: jest.fn(),
  getSafeAccountByOwner: jest.fn()
}))

const OWNER = '0xD8293ad21678c6F09Da139b4B62D38e514a03B78'
const OTHER_OWNER = '0x94b0080a00579c1307b0ef2c499ad98a8ce58e58'
const SAFE_A = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const SAFE_B = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const SAFE_C = '0x4200000000000000000000000000000000000006'
const SAFE_D = '0x0000000000000000000000000000000000000001'
const SAFE_E = '0x0000000000000000000000000000000000000002'
const SAFE_F = '0x0000000000000000000000000000000000000003'

const createApi = ({ safes = [] }: { safes?: string[] }) => ({
  getSafesByOwner: jest.fn(async () => ({ safes }))
})

const createController = (chainIds: bigint[]) =>
  new SafeController({
    accounts: {
      accounts: [],
      accountStates: {},
      initialLoadPromise: Promise.resolve()
    } as any,
    networks: {
      initialLoadPromise: Promise.resolve(),
      networks: chainIds.map((chainId) => ({ chainId, name: `Network ${chainId.toString()}` }))
    } as any,
    providers: { providers: {} } as any,
    storage: { get: jest.fn(async (_key: string, fallback: unknown) => fallback) } as any
  })

describe('SafeController findSafesByOwner', () => {
  beforeEach(() => {
    jest.mocked(getApiKit).mockReset()
    jest.mocked(getSafeAccountByOwner).mockReset()
    jest.mocked(getSafeAccountByOwner).mockImplementation(async (safeAddr, _owner, deployedOn) => ({
      account: {
        addr: getAddress(safeAddr),
        deployedOn
      } as SafeAccountByOwner,
      failed: false
    }))
  })

  it('searches supported networks in batches and emits each completed batch', async () => {
    const chainIds = [1n, 10n, 56n, 100n, 137n, 8453n]
    const apis = new Map<bigint, ReturnType<typeof createApi>>()
    chainIds.forEach((chainId) => apis.set(chainId, createApi({ safes: [] })))
    apis.set(1n, createApi({ safes: [SAFE_A] }))
    apis.set(10n, createApi({ safes: [SAFE_A] }))

    let resolveLastBatch!: (value: { safes: string[] }) => void
    const lastBatchPromise = new Promise<{ safes: string[] }>((resolve) => {
      resolveLastBatch = resolve
    })
    const lastApi = createApi({ safes: [] })
    lastApi.getSafesByOwner.mockImplementation(() => lastBatchPromise)
    apis.set(8453n, lastApi)
    jest.mocked(getApiKit).mockImplementation((chainId) => apis.get(chainId) as any)

    const controller = createController(chainIds)
    let resolveFirstBatch!: () => void
    const firstBatchEmitted = new Promise<void>((resolve) => {
      resolveFirstBatch = resolve
    })
    controller.onUpdate(() => {
      if (controller.safeOwnerSearch?.searchedNetworks.length === 4) resolveFirstBatch()
    })

    const searchPromise = controller.findSafesByOwner(OWNER)
    await firstBatchEmitted

    expect(controller.safeOwnerSearch?.accounts).toHaveLength(1)
    expect(controller.safeOwnerSearch?.accounts[0]?.deployedOn).toEqual([1n, 10n])

    resolveLastBatch({ safes: [SAFE_B] })
    await searchPromise

    expect(controller.safeOwnerSearch?.accounts.map((account) => account.addr)).toEqual([
      getAddress(SAFE_A),
      getAddress(SAFE_B)
    ])
    expect(controller.safeOwnerSearch?.searchedNetworks).toEqual(chainIds)
  })

  it('emits each completed Safe account batch before completing its network batch', async () => {
    const safes = [SAFE_A, SAFE_B, SAFE_C, SAFE_D, SAFE_E, SAFE_F]
    jest.mocked(getApiKit).mockReturnValue(createApi({ safes }) as any)

    let resolveLastSafeBatch!: () => void
    const lastSafeBatchPromise = new Promise<void>((resolve) => {
      resolveLastSafeBatch = resolve
    })
    jest.mocked(getSafeAccountByOwner).mockImplementation(async (safeAddr, _owner, deployedOn) => {
      if (safeAddr === SAFE_E) await lastSafeBatchPromise

      return {
        account: {
          addr: getAddress(safeAddr),
          deployedOn
        } as SafeAccountByOwner,
        failed: false
      }
    })

    const controller = createController([1n])
    let resolveFirstSafeBatch!: () => void
    const firstSafeBatchEmitted = new Promise<void>((resolve) => {
      resolveFirstSafeBatch = resolve
    })
    controller.onUpdate(() => {
      if (controller.safeOwnerSearch?.accounts.length === 4) resolveFirstSafeBatch()
    })

    const searchPromise = controller.findSafesByOwner(OWNER)
    await firstSafeBatchEmitted

    expect(controller.safeOwnerSearch?.accounts.map((account) => account.addr)).toEqual(
      safes.slice(0, 4).map((safe) => getAddress(safe))
    )
    expect(controller.safeOwnerSearch?.searchedNetworks).toEqual([])

    resolveLastSafeBatch()
    await searchPromise

    expect(controller.safeOwnerSearch?.accounts.map((account) => account.addr)).toEqual(
      safes.map((safe) => getAddress(safe))
    )
    expect(controller.safeOwnerSearch?.searchedNetworks).toEqual([1n])
  })

  it('keeps results from successful networks and reports failed networks', async () => {
    const mainnetApi = createApi({ safes: [SAFE_A] })
    const optimismApi = createApi({ safes: [] })
    optimismApi.getSafesByOwner.mockRejectedValue(new Error('Service unavailable'))
    jest
      .mocked(getApiKit)
      .mockImplementation((chainId) => (chainId === 1n ? mainnetApi : optimismApi) as any)
    const controller = createController([1n, 10n])

    await controller.findSafesByOwner(OWNER)

    expect(controller.safeOwnerSearch?.accounts).toHaveLength(1)
    expect(controller.safeOwnerSearch?.failedNetworks).toEqual([10n])
    expect(controller.safeOwnerSearch?.searchedNetworks).toEqual([1n, 10n])
  })

  it('replaces the previous results when searching for another owner', async () => {
    const api = createApi({ safes: [] })
    api.getSafesByOwner
      .mockResolvedValueOnce({ safes: [SAFE_A] })
      .mockResolvedValueOnce({ safes: [SAFE_B] })
    jest.mocked(getApiKit).mockReturnValue(api as any)
    const controller = createController([1n])

    await controller.findSafesByOwner(OWNER)
    await controller.findSafesByOwner(OTHER_OWNER)

    expect(controller.safeOwnerSearch?.owner).toBe(getAddress(OTHER_OWNER))
    expect(controller.safeOwnerSearch?.accounts.map((account) => account.addr)).toEqual([
      getAddress(SAFE_B)
    ])
  })
})
