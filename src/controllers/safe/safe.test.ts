import { describe, expect, it, jest } from '@jest/globals'
import { getAddress } from 'ethers'

import { getApiKit } from '../../libs/safe/safe'
import { SafeController } from './safe'

jest.mock('../../libs/safe/safe', () => ({
  ...jest.requireActual('../../libs/safe/safe'),
  getApiKit: jest.fn()
}))

const OWNER = '0xD8293ad21678c6F09Da139b4B62D38e514a03B78'
const OTHER_OWNER = '0x94b0080A00579C1307B0eF2C499AD98A8ce58e58'
const SAFE_A = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const SAFE_B = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

const getSafeInfo = (address: string, owners = [OWNER]) => ({
  address,
  fallbackHandler: '0x0000000000000000000000000000000000000000',
  guard: '0x0000000000000000000000000000000000000000',
  masterCopy: '0x0000000000000000000000000000000000000000',
  modules: [],
  nonce: 0,
  owners,
  threshold: 1,
  version: '1.4.1'
})

const getSafeCreationInfo = () => ({
  created: '2025-01-01T00:00:00Z',
  creator: OWNER,
  factoryAddress: '0x1234567890123456789012345678901234567890',
  saltNonce: '1',
  setupData: '0x1234',
  singleton: '0x2345678901234567890123456789012345678901',
  transactionHash: `0x${'1'.repeat(64)}`
})

const createApi = ({ safes = [], owners = [OWNER] }: { safes?: string[]; owners?: string[] }) => ({
  getSafeCreationInfo: jest.fn(async () => getSafeCreationInfo()),
  getSafeInfo: jest.fn(async (address: string) => getSafeInfo(address, owners)),
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

  it('falls back to the next deployed network when fetching Safe details fails', async () => {
    const mainnetApi = createApi({ safes: [SAFE_A] })
    mainnetApi.getSafeInfo.mockRejectedValue(new Error('Service unavailable'))
    const optimismApi = createApi({ safes: [SAFE_A] })
    jest
      .mocked(getApiKit)
      .mockImplementation((chainId) => (chainId === 1n ? mainnetApi : optimismApi) as any)
    const controller = createController([1n, 10n])

    await controller.findSafesByOwner(OWNER)

    expect(mainnetApi.getSafeInfo).toHaveBeenCalledWith(SAFE_A)
    expect(mainnetApi.getSafeCreationInfo).not.toHaveBeenCalled()
    expect(optimismApi.getSafeInfo).toHaveBeenCalledWith(SAFE_A)
    expect(optimismApi.getSafeCreationInfo).toHaveBeenCalledWith(SAFE_A)
    expect(controller.safeOwnerSearch?.accounts).toHaveLength(1)
    expect(controller.safeOwnerSearch?.failedNetworks).toEqual([])
  })

  it('falls back to the next deployed network when the first one does not include the owner', async () => {
    const mainnetApi = createApi({ safes: [SAFE_A], owners: [OTHER_OWNER] })
    const optimismApi = createApi({ safes: [SAFE_A] })
    jest
      .mocked(getApiKit)
      .mockImplementation((chainId) => (chainId === 1n ? mainnetApi : optimismApi) as any)
    const controller = createController([1n, 10n])

    await controller.findSafesByOwner(OWNER)

    expect(mainnetApi.getSafeInfo).toHaveBeenCalledWith(SAFE_A)
    expect(mainnetApi.getSafeCreationInfo).not.toHaveBeenCalled()
    expect(optimismApi.getSafeInfo).toHaveBeenCalledWith(SAFE_A)
    expect(optimismApi.getSafeCreationInfo).toHaveBeenCalledWith(SAFE_A)
    expect(controller.safeOwnerSearch?.accounts).toHaveLength(1)
    expect(controller.safeOwnerSearch?.failedNetworks).toEqual([])
  })

  it('does not import an account when the Safe no longer includes the requested owner', async () => {
    const api = createApi({ safes: [SAFE_A], owners: [OTHER_OWNER] })
    jest.mocked(getApiKit).mockReturnValue(api as any)
    const controller = createController([1n])

    await controller.findSafesByOwner(OWNER)

    expect(controller.safeOwnerSearch?.accounts).toEqual([])
  })

  it('does not publish stale results after the search is reset', async () => {
    let resolveSearch!: (value: { safes: string[] }) => void
    const searchResponse = new Promise<{ safes: string[] }>((resolve) => {
      resolveSearch = resolve
    })
    const api = createApi({ safes: [] })
    api.getSafesByOwner.mockImplementation(() => searchResponse)
    jest.mocked(getApiKit).mockReturnValue(api as any)
    const controller = createController([1n])

    const searchPromise = controller.findSafesByOwner(OWNER)
    await controller.resetFindSafesByOwner()
    resolveSearch({ safes: [SAFE_A] })
    await searchPromise

    expect(controller.safeOwnerSearch).toBeUndefined()
  })
})
