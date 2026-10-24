import { getAddress } from 'ethers'

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { Account } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { SafeAccountByOwner } from '../../interfaces/safe'
import {
  fetchAllPending,
  findDeployData,
  getApiKit,
  getSafeAccountByOwner
} from '../../libs/safe/safe'
import { SafeController } from './safe'

jest.mock('../../libs/safe/safe', () => ({
  ...jest.requireActual<typeof import('../../libs/safe/safe')>('../../libs/safe/safe'),
  fetchAllPending: jest.fn(),
  findDeployData: jest.fn(),
  getApiKit: jest.fn(),
  getSafeAccountByOwner: jest.fn()
}))

// The pause between requests to the Safe API is not what is tested
jest.mock('../../utils/wait', () => jest.fn(async () => {}))

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

const createController = (chainIds: bigint[], providers = {}) =>
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
    providers: { providers } as any,
    storage: { get: jest.fn(async (_key: string, fallback: unknown) => fallback) } as any,
    keystore: { getAccountKeys: () => [] } as any
  })

const getOwnerSearch = (controller: SafeController, owner = OWNER) =>
  controller.safeOwnerSearches[getAddress(owner) as Hex]

describe('SafeController findSafe', () => {
  beforeEach(() => {
    jest.mocked(findDeployData).mockReset()
    jest.mocked(getApiKit).mockReset()
  })

  it('uses recovered deployment data when importing a Safe', async () => {
    const provider = { getCode: jest.fn(async () => '0x1234') }
    const safeCreation = {
      factoryAddr: '0x1234567890123456789012345678901234567890' as Hex,
      singleton: '0x2345678901234567890123456789012345678901' as Hex,
      setupData: '0x1234' as Hex,
      saltNonce: `0x${'0'.repeat(63)}1` as Hex
    }
    const getSafeInfo = jest.fn(async () => ({
      address: SAFE_A,
      owners: [OWNER],
      version: '1.4.1'
    }))
    jest.mocked(getApiKit).mockReturnValue({ getSafeInfo } as any)
    jest.mocked(findDeployData).mockResolvedValue(safeCreation)
    const controller = createController([1n], { '1': provider })

    await controller.findSafe(SAFE_A)

    expect(findDeployData).toHaveBeenCalledWith(SAFE_A, 1n, provider)
    expect(controller.safeInfo).toMatchObject({
      ...safeCreation,
      address: SAFE_A,
      owners: [OWNER],
      deployedOn: [1n]
    })
    expect(controller.importError).toBeUndefined()
  })

  it('keeps partial deployment data', async () => {
    const provider = { getCode: jest.fn(async () => '0x1234') }
    const getSafeInfo = jest.fn(async () => ({
      address: SAFE_A,
      owners: [OWNER],
      version: '1.4.1'
    }))
    jest.mocked(getApiKit).mockReturnValue({ getSafeInfo } as any)
    jest.mocked(findDeployData).mockResolvedValue({
      factoryAddr: '0x',
      singleton: '0x',
      setupData: '0x',
      saltNonce: '0x'
    })
    const controller = createController([1n], { '1': provider })

    await controller.findSafe(SAFE_A)

    expect(controller.safeInfo).toMatchObject({
      factoryAddr: '0x',
      singleton: '0x',
      setupData: '0x',
      saltNonce: '0x'
    })
    // the Safe version is chain specific, so it's read in the account state instead
    expect(controller.safeInfo).not.toHaveProperty('version')
    expect(controller.importError).toBeUndefined()
  })
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
      if (getOwnerSearch(controller)?.searchedNetworks.length === 4) resolveFirstBatch()
    })

    const searchPromise = controller.findSafesByOwner(OWNER)
    await firstBatchEmitted

    expect(getOwnerSearch(controller)?.accounts).toHaveLength(1)
    expect(getOwnerSearch(controller)?.accounts[0]?.deployedOn).toEqual([1n, 10n])

    resolveLastBatch({ safes: [SAFE_B] })
    await searchPromise

    expect(getOwnerSearch(controller)?.accounts.map((account) => account.addr)).toEqual([
      getAddress(SAFE_A),
      getAddress(SAFE_B)
    ])
    expect(getOwnerSearch(controller)?.searchedNetworks).toEqual(chainIds)
    expect(getOwnerSearch(controller)?.updatedAt).toBeGreaterThan(0)
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
      if (getOwnerSearch(controller)?.accounts.length === 4) resolveFirstSafeBatch()
    })

    const searchPromise = controller.findSafesByOwner(OWNER)
    await firstSafeBatchEmitted

    expect(getOwnerSearch(controller)?.accounts.map((account) => account.addr)).toEqual(
      safes.slice(0, 4).map((safe) => getAddress(safe))
    )
    expect(getOwnerSearch(controller)?.searchedNetworks).toEqual([])
    expect(getOwnerSearch(controller)?.updatedAt).toBeGreaterThan(0)
    expect(getOwnerSearch(controller)?.status).toBe('LOADING')

    resolveLastSafeBatch()
    await searchPromise

    expect(getOwnerSearch(controller)?.accounts.map((account) => account.addr)).toEqual(
      safes.map((safe) => getAddress(safe))
    )
    expect(getOwnerSearch(controller)?.searchedNetworks).toEqual([1n])
    expect(getOwnerSearch(controller)?.updatedAt).toBeGreaterThan(0)
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

    expect(getOwnerSearch(controller)?.accounts).toHaveLength(1)
    expect(getOwnerSearch(controller)?.failedNetworks).toEqual([10n])
    expect(getOwnerSearch(controller)?.searchedNetworks).toEqual([1n, 10n])
    expect(getOwnerSearch(controller)?.updatedAt).toBeGreaterThan(0)
  })

  it('keeps search results separate for each owner', async () => {
    const api = createApi({ safes: [] })
    api.getSafesByOwner
      .mockResolvedValueOnce({ safes: [SAFE_A] })
      .mockResolvedValueOnce({ safes: [SAFE_B] })
    jest.mocked(getApiKit).mockReturnValue(api as any)
    const controller = createController([1n])

    await controller.findSafesByOwner(OWNER)
    await controller.findSafesByOwner(OTHER_OWNER)

    expect(getOwnerSearch(controller)?.accounts.map((account) => account.addr)).toEqual([
      getAddress(SAFE_A)
    ])
    expect(getOwnerSearch(controller, OTHER_OWNER)?.owner).toBe(getAddress(OTHER_OWNER))
    expect(
      getOwnerSearch(controller, OTHER_OWNER)?.accounts.map((account) => account.addr)
    ).toEqual([getAddress(SAFE_B)])
  })

  it('replaces only the matching stale owner cache when searching again', async () => {
    const api = createApi({ safes: [] })
    api.getSafesByOwner
      .mockResolvedValueOnce({ safes: [SAFE_A] })
      .mockResolvedValueOnce({ safes: [SAFE_B] })
      .mockResolvedValueOnce({ safes: [SAFE_C] })
    jest.mocked(getApiKit).mockReturnValue(api as any)
    const controller = createController([1n])

    await controller.findSafesByOwner(OWNER)
    await controller.findSafesByOwner(OTHER_OWNER)
    getOwnerSearch(controller)!.updatedAt = 0
    await controller.findSafesByOwner(OWNER.toLowerCase())

    expect(Object.keys(controller.safeOwnerSearches)).toHaveLength(2)
    expect(getOwnerSearch(controller)?.accounts.map((account) => account.addr)).toEqual([
      getAddress(SAFE_C)
    ])
    expect(
      getOwnerSearch(controller, OTHER_OWNER)?.accounts.map((account) => account.addr)
    ).toEqual([getAddress(SAFE_B)])
  })

  it('does not cancel an active owner search when another owner search fails', async () => {
    let resolveSearch!: (value: { safes: string[] }) => void
    let markSearchAsStarted!: () => void
    const searchStarted = new Promise<void>((resolve) => {
      markSearchAsStarted = resolve
    })
    const searchResponse = new Promise<{ safes: string[] }>((resolve) => {
      resolveSearch = resolve
    })
    const api = createApi({ safes: [] })
    api.getSafesByOwner
      .mockImplementationOnce(() => {
        markSearchAsStarted()
        return searchResponse
      })
      .mockRejectedValueOnce(new Error('Service unavailable'))
    jest.mocked(getApiKit).mockReturnValue(api as any)
    const controller = createController([1n])

    const ownerSearchPromise = controller.findSafesByOwner(OWNER)
    await searchStarted
    await controller.findSafesByOwner(OTHER_OWNER)
    resolveSearch({ safes: [SAFE_A] })
    await ownerSearchPromise

    expect(getOwnerSearch(controller)?.accounts.map((account) => account.addr)).toEqual([
      getAddress(SAFE_A)
    ])
    expect(getOwnerSearch(controller, OTHER_OWNER)?.failedNetworks).toEqual([1n])
    expect(getOwnerSearch(controller, OTHER_OWNER)?.status).toBe('DONE')
  })

  it('debounces a repeated search for the same owner while loading', async () => {
    let resolveSearch!: (value: { safes: string[] }) => void
    let markSearchAsStarted!: () => void
    const searchStarted = new Promise<void>((resolve) => {
      markSearchAsStarted = resolve
    })
    const searchResponse = new Promise<{ safes: string[] }>((resolve) => {
      resolveSearch = resolve
    })
    const api = createApi({ safes: [] })
    api.getSafesByOwner.mockImplementation(() => {
      markSearchAsStarted()
      return searchResponse
    })
    jest.mocked(getApiKit).mockReturnValue(api as any)
    const controller = createController([1n])

    const ownerSearchPromise = controller.findSafesByOwner(OWNER)
    await searchStarted
    const repeatedSearchPromise = controller.findSafesByOwner(OWNER.toLowerCase())
    resolveSearch({ safes: [SAFE_A] })
    await Promise.all([ownerSearchPromise, repeatedSearchPromise])

    expect(api.getSafesByOwner).toHaveBeenCalledTimes(1)
    expect(getOwnerSearch(controller)?.accounts.map((account) => account.addr)).toEqual([
      getAddress(SAFE_A)
    ])
    expect(getOwnerSearch(controller)?.status).toBe('DONE')
  })
})

describe('SafeController createSafeAccount', () => {
  // verified against the v1.4.1 SafeProxyFactory, see libs/safe/safe.test.ts
  const OWNERS = [OWNER, '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'] as Hex[]
  const SAFE_ADDR = '0x913F170e793293e71749ee6CA674DF0469Ee3735'

  const createControllerWithAddAccounts = ({
    accountsInWallet = [],
    failsToAddAccounts = false
  }: {
    accountsInWallet?: Account[]
    /** Mimics AccountsController.addAccounts, which emits its errors instead of throwing them */
    failsToAddAccounts?: boolean
  } = {}) => {
    const accounts = {
      accounts: [...accountsInWallet],
      accountStates: {},
      initialLoadPromise: Promise.resolve(),
      addAccounts: jest.fn(async (accountsToAdd: Account[]) => {
        if (!failsToAddAccounts) accounts.accounts.push(...accountsToAdd)
      })
    }
    const { addAccounts } = accounts
    const controller = new SafeController({
      accounts: accounts as any,
      networks: { initialLoadPromise: Promise.resolve(), networks: [] } as any,
      providers: { providers: {} } as any,
      storage: { get: jest.fn(async (_key: string, fallback: unknown) => fallback) } as any,
      keystore: { getAccountKeys: () => [] } as any
    })

    return { controller, addAccounts }
  }

  // withStatus resets the status to INITIAL before it resolves, so the statuses
  // in between can be read only from the emitted updates
  const recordCreateSafeAccountStatuses = (controller: SafeController) => {
    const statuses: string[] = []
    controller.onUpdate(() => statuses.push(controller.statuses.createSafeAccount))
    return statuses
  }

  it('adds the new Safe account with its counterfactual address', async () => {
    const { controller, addAccounts } = createControllerWithAddAccounts()
    const statuses = recordCreateSafeAccountStatuses(controller)

    await controller.createSafeAccount(OWNERS, 2)

    expect(addAccounts).toHaveBeenCalledWith([
      expect.objectContaining({
        addr: SAFE_ADDR,
        associatedKeys: OWNERS,
        preferences: { label: 'Account 1', pfp: SAFE_ADDR },
        creation: null,
        safeCreation: expect.objectContaining({
          factoryAddr: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
          singleton: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762'
        })
      })
    ])
    expect(statuses).toContain('SUCCESS')
    expect(statuses).not.toContain('ERROR')
    expect(controller.statuses.createSafeAccount).toBe('INITIAL')
  })

  it('does not add an account for an invalid setup', async () => {
    const { controller, addAccounts } = createControllerWithAddAccounts()
    const statuses = recordCreateSafeAccountStatuses(controller)
    const onError = jest.fn()
    controller.onError(onError)

    await controller.createSafeAccount([OWNER as Hex], 2)

    expect(addAccounts).not.toHaveBeenCalled()
    expect(statuses).toContain('ERROR')
    expect(statuses).not.toContain('SUCCESS')
    expect(controller.statuses.createSafeAccount).toBe('INITIAL')
    expect(onError).toHaveBeenCalled()
  })

  it('errors when the same Safe is already in the wallet', async () => {
    const { controller, addAccounts } = createControllerWithAddAccounts({
      accountsInWallet: [{ addr: SAFE_ADDR } as Account]
    })
    const statuses = recordCreateSafeAccountStatuses(controller)
    const onError = jest.fn()
    controller.onError(onError)

    await controller.createSafeAccount(OWNERS, 2)

    expect(addAccounts).not.toHaveBeenCalled()
    expect(statuses).toContain('ERROR')
    expect(statuses).not.toContain('SUCCESS')
    expect(controller.emittedErrors.at(-1)?.message).toContain('already in your wallet')
  })

  it('errors instead of succeeding when the account was not added', async () => {
    const { controller, addAccounts } = createControllerWithAddAccounts({
      failsToAddAccounts: true
    })
    const statuses = recordCreateSafeAccountStatuses(controller)
    const onError = jest.fn()
    controller.onError(onError)

    await controller.createSafeAccount(OWNERS, 2)

    expect(addAccounts).toHaveBeenCalled()
    expect(statuses).toContain('ERROR')
    expect(statuses).not.toContain('SUCCESS')
    expect(onError).toHaveBeenCalled()
  })
})

describe('SafeController pending counts', () => {
  const NOT_A_SAFE = '0x0000000000000000000000000000000000000004'
  const safeCreation = { factoryAddr: '0x', singleton: '0x', setupData: '0x', saltNonce: '0x' }
  const safeAccount = (addr: string) => ({ addr, safeCreation, associatedKeys: [OWNER] })

  const createPendingCountsController = ({
    accountStates,
    importedKeyAddrs = [OWNER]
  }: {
    accountStates: Record<string, Record<string, { isDeployed: boolean; threshold: number }>>
    importedKeyAddrs?: string[]
  }) => {
    const accounts = {
      accounts: [
        safeAccount(SAFE_A),
        safeAccount(SAFE_B),
        { addr: NOT_A_SAFE, associatedKeys: [] }
      ],
      accountStates,
      initialLoadPromise: Promise.resolve(),
      getOrFetchAccountStates: jest.fn(async (addr: string) => accountStates[addr])
    }
    const controller = new SafeController({
      accounts: accounts as any,
      networks: {
        initialLoadPromise: Promise.resolve(),
        networks: [{ chainId: 1n }, { chainId: 10n }, { chainId: 8453n }]
      } as any,
      providers: { providers: {} } as any,
      storage: { get: jest.fn(async (_key: string, fallback: unknown) => fallback) } as any,
      keystore: {
        getAccountKeys: ({ associatedKeys }: { associatedKeys: string[] }) =>
          importedKeyAddrs
            .filter((addr) => associatedKeys.includes(addr))
            .map((addr) => ({ addr, type: 'internal' }))
      } as any
    })

    return { controller, accounts, importedKeyAddrs }
  }

  const pendingResponse = (
    chainId: bigint,
    txnsCount: number,
    confirmationsPerMessage: number[]
  ) => ({
    [chainId.toString()]: {
      txns: Array.from({ length: txnsCount }, (_, i) => ({ safeTxHash: `0x${i}` })),
      messages: confirmationsPerMessage.map((confirmations, i) => ({
        messageHash: `0x${i}`,
        created: new Date().toISOString(),
        confirmations: Array.from({ length: confirmations }, () => ({}))
      }))
    }
  })

  beforeEach(() => {
    jest.mocked(fetchAllPending).mockReset()
    jest
      .mocked(fetchAllPending)
      .mockImplementation(async (networks) => pendingResponse(networks[0]!.chainId, 1, []) as any)
  })

  it('counts the pending txns and the messages that still need signatures, per chain', async () => {
    const { controller } = createPendingCountsController({
      accountStates: { [SAFE_A]: { '1': { isDeployed: true, threshold: 2 } } }
    })
    await controller.initialLoadPromise
    // the message with 2 of 2 confirmations is complete, so it's not pending
    jest.mocked(fetchAllPending).mockResolvedValueOnce(pendingResponse(1n, 2, [1, 2]) as any)

    await controller.fetchPending(SAFE_A as Hex, [{ chainId: 1n, threshold: 2 }])

    expect(controller.pendingCountBySafe[SAFE_A]).toEqual({ '1': 3 })
  })

  it('updates only the chain that was fetched and keeps the counts of the others', async () => {
    const { controller } = createPendingCountsController({
      accountStates: {
        [SAFE_A]: {
          '1': { isDeployed: true, threshold: 1 },
          '10': { isDeployed: true, threshold: 1 }
        }
      }
    })
    await controller.initialLoadPromise
    jest.mocked(fetchAllPending).mockResolvedValueOnce(pendingResponse(1n, 2, []) as any)
    await controller.fetchPending(SAFE_A as Hex, [{ chainId: 1n, threshold: 1 }])
    jest.mocked(fetchAllPending).mockResolvedValueOnce(pendingResponse(10n, 0, []) as any)

    await controller.fetchPending(SAFE_A as Hex, [{ chainId: 10n, threshold: 1 }])

    expect(controller.pendingCountBySafe[SAFE_A]).toEqual({ '1': 2, '10': 0 })
  })

  it('fetches the other Safes on their deployed chains only, skipping the selected one and non-Safes', async () => {
    const { controller } = createPendingCountsController({
      accountStates: {
        [SAFE_A]: { '1': { isDeployed: true, threshold: 1 } },
        [SAFE_B]: {
          '1': { isDeployed: true, threshold: 1 },
          '10': { isDeployed: false, threshold: 0 },
          '8453': { isDeployed: true, threshold: 2 }
        }
      }
    })
    await controller.initialLoadPromise

    await controller.updateOtherSafesPendingCounts(SAFE_A)

    expect(jest.mocked(fetchAllPending).mock.calls).toEqual([
      [[{ chainId: 1n, threshold: 1 }], SAFE_B],
      [[{ chainId: 8453n, threshold: 2 }], SAFE_B]
    ])
    expect(controller.pendingCountBySafe).toEqual({ [SAFE_B]: { '1': 1, '8453': 1 } })
  })

  it('skips the Safes without an imported owner, as the user cannot sign what is pending', async () => {
    const { controller } = createPendingCountsController({
      accountStates: {
        [SAFE_A]: { '1': { isDeployed: true, threshold: 1 } },
        [SAFE_B]: { '1': { isDeployed: true, threshold: 1 } }
      },
      importedKeyAddrs: [OTHER_OWNER]
    })
    await controller.initialLoadPromise

    await controller.updateOtherSafesPendingCounts()

    expect(fetchAllPending).not.toHaveBeenCalled()
    expect(controller.pendingCountBySafe).toEqual({})
  })

  it('clears the counts of a Safe whose owners were removed and fetches them again once one is back', async () => {
    const { controller, importedKeyAddrs } = createPendingCountsController({
      accountStates: { [SAFE_B]: { '1': { isDeployed: true, threshold: 1 } } }
    })
    await controller.initialLoadPromise
    await controller.updateOtherSafesPendingCounts(SAFE_A)
    expect(controller.pendingCountBySafe[SAFE_B]).toEqual({ '1': 1 })

    importedKeyAddrs.splice(0)
    await controller.updateOtherSafesPendingCounts(SAFE_A)
    expect(controller.pendingCountBySafe).toEqual({})
    expect(fetchAllPending).toHaveBeenCalledTimes(1)

    // Well within the 15 minutes, as the count was cleared rather than refreshed
    importedKeyAddrs.push(OWNER)
    await controller.updateOtherSafesPendingCounts(SAFE_A)
    expect(controller.pendingCountBySafe[SAFE_B]).toEqual({ '1': 1 })
    expect(fetchAllPending).toHaveBeenCalledTimes(2)
  })

  it('keeps the counts of the selected Safe without owners, as it is not refreshed from here', async () => {
    const { controller, importedKeyAddrs } = createPendingCountsController({ accountStates: {} })
    await controller.initialLoadPromise
    await controller.fetchPending(SAFE_A as Hex, [{ chainId: 1n, threshold: 1 }])

    importedKeyAddrs.splice(0)
    await controller.updateOtherSafesPendingCounts(SAFE_A)

    expect(controller.pendingCountBySafe[SAFE_A]).toEqual({ '1': 1 })
  })

  it('skips a Safe whose counts are younger than 15 minutes and fetches it again after', async () => {
    const { controller } = createPendingCountsController({
      accountStates: { [SAFE_B]: { '1': { isDeployed: true, threshold: 1 } } }
    })
    await controller.initialLoadPromise
    const now = Date.now()
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now)

    try {
      await controller.updateOtherSafesPendingCounts(SAFE_A)
      dateNowSpy.mockReturnValue(now + 15 * 60 * 1000 - 1)
      await controller.updateOtherSafesPendingCounts(SAFE_A)
      expect(fetchAllPending).toHaveBeenCalledTimes(1)

      dateNowSpy.mockReturnValue(now + 15 * 60 * 1000)
      await controller.updateOtherSafesPendingCounts(SAFE_A)
      expect(fetchAllPending).toHaveBeenCalledTimes(2)
    } finally {
      dateNowSpy.mockRestore()
    }
  })

  it('tracks when each Safe was fetched separately', async () => {
    const { controller } = createPendingCountsController({ accountStates: {} })
    await controller.initialLoadPromise

    await controller.fetchPending(SAFE_A as Hex, [{ chainId: 1n, threshold: 1 }])

    expect(controller.shouldSkipFetchPending(SAFE_A)).toBe(true)
    expect(controller.shouldSkipFetchPending(SAFE_B)).toBe(false)
  })

  it('keeps the last counts and goes on with the next chain when a fetch fails', async () => {
    const { controller } = createPendingCountsController({
      accountStates: {
        [SAFE_B]: {
          '1': { isDeployed: true, threshold: 1 },
          '10': { isDeployed: true, threshold: 1 }
        }
      }
    })
    await controller.initialLoadPromise
    jest.mocked(fetchAllPending).mockResolvedValueOnce(pendingResponse(1n, 4, []) as any)
    await controller.fetchPending(SAFE_B as Hex, [{ chainId: 1n, threshold: 1 }])
    const onError = jest.fn()
    controller.onError(onError)
    jest
      .mocked(fetchAllPending)
      .mockRejectedValueOnce(new Error('Too many requests'))
      .mockResolvedValueOnce(pendingResponse(10n, 1, []) as any)
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 15 * 60 * 1000)

    try {
      await controller.updateOtherSafesPendingCounts(SAFE_A)
    } finally {
      dateNowSpy.mockRestore()
    }

    expect(controller.pendingCountBySafe[SAFE_B]).toEqual({ '1': 4, '10': 1 })
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('runs a single update at a time', async () => {
    const { controller, accounts } = createPendingCountsController({
      accountStates: { [SAFE_B]: { '1': { isDeployed: true, threshold: 1 } } }
    })
    await controller.initialLoadPromise

    await Promise.all([
      controller.updateOtherSafesPendingCounts(SAFE_A),
      controller.updateOtherSafesPendingCounts(SAFE_A)
    ])

    expect(accounts.getOrFetchAccountStates).toHaveBeenCalledTimes(1)
    expect(fetchAllPending).toHaveBeenCalledTimes(1)
  })
})
