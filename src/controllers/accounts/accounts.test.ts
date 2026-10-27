import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { mockInternalKeys, produceMemoryStore } from '../../../test/helpers'
import { makeMainController } from '../../../test/helpers/mainController'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import {
  Account,
  AccountOnchainState,
  IAccountsController,
  SafeAccountCreation
} from '../../interfaces/account'
import { ErrorRef } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { UiManager } from '../../interfaces/ui'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import * as accountStateLib from '../../libs/accountState/accountState'
import { ACCOUNT_OP_PENDING_TIMEOUT_MS } from '../../consts/activity'
import { StorageController } from '../storage/storage'
import { AccountsController } from './accounts'

const accounts = [
  {
    addr: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
    associatedKeys: ['0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'],
    initialPrivileges: [],
    creation: null,
    preferences: {
      label: DEFAULT_ACCOUNT_LABEL,
      pfp: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'
    }
  },
  {
    addr: '0x71c3D24a627f0416db45107353d8d0A5ae0401ae',
    associatedKeys: ['0x71c3D24a627f0416db45107353d8d0A5ae0401ae'],
    initialPrivileges: [],
    creation: null,
    preferences: {
      label: DEFAULT_ACCOUNT_LABEL,
      pfp: '0x71c3D24a627f0416db45107353d8d0A5ae0401ae'
    }
  }
]

describe('AccountsController', () => {
  let accountsCtrl: IAccountsController

  test('should init AccountsController', async () => {
    const mockKeys = mockInternalKeys(accounts)
    const { mainCtrl } = await makeMainController(
      async (storageCtrl) => {
        await storageCtrl.set('accounts', accounts)
        await storageCtrl.set('selectedAccount', accounts[0]!.addr)
        await storageCtrl.set('keystoreKeys', mockKeys)
      },
      { skipAccountStateLoad: false }
    )

    accountsCtrl = mainCtrl.accounts

    expect(accountsCtrl).toBeDefined()

    expect(accountsCtrl.areAccountStatesLoading).toBe(false)
  })
  test('update account preferences', async () => {
    await accountsCtrl.updateAccountPreferences([
      {
        addr: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
        preferences: {
          label: 'new-label',
          pfp: 'predefined-image'
        }
      }
    ])

    const acc = accountsCtrl.accounts.find(
      (a) => a.addr === '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'
    )
    expect(acc?.preferences.label).toEqual('new-label')
    expect(acc?.preferences.pfp).toEqual('predefined-image')
  })
  test('removeAccountData', async () => {
    await accountsCtrl.updateAccountState(accounts[0]!.addr)
    expect(accountsCtrl.accounts.length).toBeGreaterThan(0)
    expect(Object.keys(accountsCtrl.accountStates).length).toBeGreaterThan(0)
    expect(accountsCtrl.areAccountStatesLoading).toBe(false)

    accountsCtrl.removeAccountData('0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0')

    accountsCtrl.removeAccountData('0x71c3D24a627f0416db45107353d8d0A5ae0401ae')

    expect(accountsCtrl.accounts.length).toEqual(0)
    expect(Object.keys(accountsCtrl.accountStates).length).toEqual(0)
  })
})

type AccountStateFetch = {
  addrs: string[]
  accounts: Account[]
  blockTag: string | number | undefined
  resolve: (states: AccountOnchainState[]) => void
  reject: (error: Error) => void
}

const ETHEREUM = networks.find(({ chainId }) => chainId === 1n)!
const BASE = networks.find(({ chainId }) => chainId === 8453n)!
const [ADDR_A, ADDR_B] = [accounts[0]!.addr, accounts[1]!.addr]

const flushPromises = () => new Promise((resolve) => setImmediate(resolve))

const makeAccountState = (accountAddr: string, currentBlock: bigint): AccountOnchainState => ({
  accountAddr,
  isDeployed: false,
  eoaNonce: currentBlock,
  nonce: currentBlock,
  erc4337Nonce: 0n,
  associatedKeys: [],
  importedAccountKeys: [],
  balance: 0n,
  isEOA: true,
  isErc4337Enabled: false,
  isErc4337Nonce: false,
  isV2: false,
  currentBlock,
  isSmarterEoa: false,
  delegatedContract: null,
  delegatedContractName: null,
  threshold: 1,
  safeVersion: null,
  updatedAt: Date.now()
})

/** Tracks a promise, so a test can tell if it settled without awaiting it. */
const track = (promise: Promise<unknown>) => {
  const tracked = { isSettled: false, promise }
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  promise.finally(() => {
    tracked.isSettled = true
  })
  return tracked
}

/**
 * Builds an AccountsController with stubbed dependencies and no RPC access.
 * `fetches` lists every `getAccountState` call, which the test settles by hand.
 */
const makeAccountsController = async ({
  sendUiMessage,
  storage = new StorageController(produceMemoryStore()),
  shouldWaitForLoad = true
}: {
  sendUiMessage?: UiManager['message']['sendUiMessage']
  /** Pass the storage of an earlier controller to start it again on the same data */
  storage?: StorageController
  /** Pass false to call the controller while it still loads */
  shouldWaitForLoad?: boolean
} = {}) => {
  const fetches: AccountStateFetch[] = []
  jest
    .spyOn(accountStateLib, 'getAccountState')
    .mockImplementation((_provider, _network, accountsToFetch, _keys, blockTag) => {
      return new Promise((resolve, reject) => {
        fetches.push({
          addrs: accountsToFetch.map(({ addr }) => addr),
          accounts: accountsToFetch,
          blockTag,
          resolve,
          reject
        })
      })
    })

  if (!(await storage.get('accounts', [])).length) await storage.set('accounts', accounts)
  const updateProviderIsWorking = jest.fn()
  const accountsCtrl = new AccountsController(
    storage,
    {
      initialLoadPromise: Promise.resolve(),
      providers: { [ETHEREUM.chainId.toString()]: {}, [BASE.chainId.toString()]: {} }
    } as unknown as IProvidersController,
    {
      initialLoadPromise: Promise.resolve(),
      networks: [ETHEREUM, BASE]
    } as unknown as INetworksController,
    { keys: [], getAccountKeys: () => [] } as unknown as IKeystoreController,
    () => {},
    updateProviderIsWorking,
    () => {},
    '',
    jest.fn<any>(),
    undefined,
    // Disabled smart accounts stop the identity intervals, so no Relayer calls run
    {
      initialLoadPromise: Promise.resolve(),
      isFeatureEnabled: () => false
    } as unknown as IFeatureFlagsController,
    sendUiMessage
  )
  if (shouldWaitForLoad) {
    await accountsCtrl.initialLoadPromise
    await accountsCtrl.accountStateInitialLoadPromise
  }
  const errors: string[] = []
  accountsCtrl.onError((error) => errors.push(error.message))

  return { accountsCtrl, storage, fetches, errors, updateProviderIsWorking }
}

describe('AccountsController account state fetching', () => {
  let ctrl: Awaited<ReturnType<typeof makeAccountsController>>

  beforeEach(async () => {
    ctrl = await makeAccountsController()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('a call for another account on the same chain does not wait for the running fetch', async () => {
    const { accountsCtrl, fetches } = ctrl
    const updateA = track(accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId]))
    await flushPromises()
    const updateB = accountsCtrl.updateAccountState(ADDR_B, 'latest', [BASE.chainId])
    await flushPromises()

    expect(fetches.map(({ addrs }) => addrs)).toEqual([[ADDR_A], [ADDR_B]])
    fetches[1]!.resolve([makeAccountState(ADDR_B, 10n)])
    await updateB

    expect(updateA.isSettled).toBe(false)
    expect(accountsCtrl.accountStates[ADDR_B]?.[BASE.chainId.toString()]?.currentBlock).toBe(10n)
  })

  test('a pending call on Ethereum is not covered by a running latest fetch', async () => {
    const { accountsCtrl, fetches } = ctrl
    const updateLatest = accountsCtrl.updateAccountState(ADDR_A, 'latest', [ETHEREUM.chainId])
    await flushPromises()
    const updatePending = accountsCtrl.updateAccountState(ADDR_A, 'pending', [ETHEREUM.chainId])
    await flushPromises()
    fetches[0]!.resolve([makeAccountState(ADDR_A, 10n)])
    await updateLatest
    await flushPromises()

    expect(fetches.map(({ blockTag }) => blockTag)).toEqual(['latest', 'pending'])
    fetches[1]!.resolve([makeAccountState(ADDR_A, 11n)])
    await updatePending
    expect(accountsCtrl.accountStates[ADDR_A]?.[ETHEREUM.chainId.toString()]?.currentBlock).toBe(
      11n
    )
  })

  test('a pending call on a chain without pending support uses the running latest fetch', async () => {
    const { accountsCtrl, fetches } = ctrl
    const updateLatest = accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId])
    await flushPromises()
    const updatePending = accountsCtrl.updateAccountState(ADDR_A, 'pending', [BASE.chainId])
    await flushPromises()
    fetches[0]!.resolve([makeAccountState(ADDR_A, 10n)])
    await Promise.all([updateLatest, updatePending])

    expect(fetches).toHaveLength(1)
  })

  test('calls without force use the running fetch', async () => {
    const { accountsCtrl, fetches } = ctrl
    const running = accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId])
    await flushPromises()
    const calls = Array.from({ length: 5 }, () =>
      accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId])
    )
    await flushPromises()
    fetches[0]!.resolve([makeAccountState(ADDR_A, 10n)])
    await Promise.all([running, ...calls])

    expect(fetches).toHaveLength(1)
  })

  test('forced calls wait for one fetch that starts after them', async () => {
    const { accountsCtrl, fetches } = ctrl
    const running = accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId])
    await flushPromises()
    const forcedCalls = Array.from({ length: 5 }, () =>
      track(accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId], true))
    )
    await flushPromises()
    fetches[0]!.resolve([makeAccountState(ADDR_A, 10n)])
    await running
    await flushPromises()

    expect(fetches).toHaveLength(2)
    expect(forcedCalls.filter(({ isSettled }) => isSettled)).toHaveLength(0)
    fetches[1]!.resolve([makeAccountState(ADDR_A, 11n)])
    await Promise.all(forcedCalls.map(({ promise }) => promise))

    expect(fetches).toHaveLength(2)
    expect(accountsCtrl.accountStates[ADDR_A]?.[BASE.chainId.toString()]?.currentBlock).toBe(11n)
  })

  test('a forced call still fetches when the running fetch fails', async () => {
    const { accountsCtrl, fetches, errors } = ctrl
    const running = accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId])
    await flushPromises()
    const forced = accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId], true)
    await flushPromises()
    fetches[0]!.reject(new Error('RPC is down'))
    await running
    await flushPromises()

    expect(errors).toEqual([`Failed to update account state for ${BASE.name}`])
    expect(fetches).toHaveLength(2)
    fetches[1]!.resolve([makeAccountState(ADDR_A, 11n)])
    await forced
    expect(accountsCtrl.accountStates[ADDR_A]?.[BASE.chainId.toString()]?.currentBlock).toBe(11n)
  })

  test('a failed forced fetch resolves every forced call it covers without another fetch', async () => {
    const { accountsCtrl, fetches, updateProviderIsWorking } = ctrl
    const running = accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId])
    await flushPromises()
    const forcedCalls = Array.from({ length: 3 }, () =>
      accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId], true)
    )
    await flushPromises()
    fetches[0]!.resolve([makeAccountState(ADDR_A, 10n)])
    await running
    await flushPromises()
    fetches[1]!.reject(new Error('RPC is down'))
    await Promise.all(forcedCalls)

    expect(fetches).toHaveLength(2)
    expect(updateProviderIsWorking).toHaveBeenLastCalledWith(BASE.chainId, false)
    expect(accountsCtrl.accountStates[ADDR_A]?.[BASE.chainId.toString()]?.currentBlock).toBe(10n)
  })

  test('a pending result from an older block does not replace the stored state', async () => {
    const { accountsCtrl, fetches } = ctrl
    const updateLatest = accountsCtrl.updateAccountState(ADDR_A, 'latest', [ETHEREUM.chainId])
    await flushPromises()
    fetches[0]!.resolve([makeAccountState(ADDR_A, 100n)])
    await updateLatest
    const updatePending = accountsCtrl.updateAccountState(ADDR_A, 'pending', [ETHEREUM.chainId])
    await flushPromises()
    fetches[1]!.resolve([makeAccountState(ADDR_A, 99n)])
    await updatePending

    expect(accountsCtrl.accountStates[ADDR_A]?.[ETHEREUM.chainId.toString()]?.currentBlock).toBe(
      100n
    )
  })

  test('a pending result from the same block replaces the stored state', async () => {
    const { accountsCtrl, fetches } = ctrl
    const updateFirst = accountsCtrl.updateAccountState(ADDR_A, 'pending', [ETHEREUM.chainId])
    await flushPromises()
    fetches[0]!.resolve([makeAccountState(ADDR_A, 100n)])
    await updateFirst
    const updateSecond = accountsCtrl.updateAccountState(ADDR_A, 'pending', [ETHEREUM.chainId])
    await flushPromises()
    fetches[1]!.resolve([{ ...makeAccountState(ADDR_A, 100n), nonce: 101n }])
    await updateSecond

    expect(accountsCtrl.accountStates[ADDR_A]?.[ETHEREUM.chainId.toString()]?.nonce).toBe(101n)
  })

  test('a removed account is not written back by a running fetch', async () => {
    const { accountsCtrl, fetches } = ctrl
    const update = accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId])
    await flushPromises()
    accountsCtrl.removeAccountData(ADDR_A)
    fetches[0]!.resolve([makeAccountState(ADDR_A, 10n)])
    await update

    expect(accountsCtrl.accountStates[ADDR_A]).toBeUndefined()
  })

  test('a queued fetch uses the Safe data saved while it waited', async () => {
    const { accountsCtrl, fetches } = ctrl
    const safeCreation: SafeAccountCreation = {
      factoryAddr: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
      singleton: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
      saltNonce: '0x01',
      setupData: '0x'
    }
    const running = accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId])
    await flushPromises()
    const forced = accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId], true)
    await flushPromises()
    await accountsCtrl.updateSafeCreation(ADDR_A, safeCreation)
    fetches[0]!.resolve([makeAccountState(ADDR_A, 10n)])
    await running
    await flushPromises()

    expect(fetches[1]?.accounts[0]?.safeCreation).toEqual(safeCreation)
    fetches[1]!.resolve([makeAccountState(ADDR_A, 11n)])
    await forced
  })

  test('the last update after the jobs end reports that nothing is loading', async () => {
    const { accountsCtrl, fetches } = ctrl
    const loadingStates: boolean[] = []
    accountsCtrl.onUpdate(() => loadingStates.push(accountsCtrl.areAccountStatesLoading))
    const update = accountsCtrl.updateAccountState(ADDR_A, 'latest', [BASE.chainId])
    await flushPromises()

    expect(loadingStates).toEqual([true])
    fetches[0]!.resolve([makeAccountState(ADDR_A, 10n)])
    await update
    expect(loadingStates.at(-1)).toBe(false)
  })

  describe('getLatestAccountNonce', () => {
    test('reads the nonce on the latest block, not from the saved states', async () => {
      const { accountsCtrl, fetches } = ctrl
      // A pending state counts txns that are not mined, so it must not answer for the latest one
      const updatePending = accountsCtrl.updateAccountState(ADDR_A, 'pending', [ETHEREUM.chainId])
      await flushPromises()
      fetches[0]!.resolve([makeAccountState(ADDR_A, 11n)])
      await updatePending

      const nonce = accountsCtrl.getLatestAccountNonce(ADDR_A, ETHEREUM.chainId)
      await flushPromises()
      expect(fetches[1]?.blockTag).toBe('latest')
      fetches[1]!.resolve([makeAccountState(ADDR_A, 10n)])

      expect(await nonce).toBe(10n)
      // Only a state fetch of its own saves a state
      expect(accountsCtrl.accountStates[ADDR_A]?.[ETHEREUM.chainId.toString()]?.nonce).toBe(11n)
    })

    test('is null, with a silent error, when the RPC fails', async () => {
      const { accountsCtrl, fetches, errors } = ctrl
      const nonce = accountsCtrl.getLatestAccountNonce(ADDR_A, BASE.chainId)
      await flushPromises()
      fetches[0]!.reject(new Error('RPC is down'))

      expect(await nonce).toBeNull()
      expect(errors).toEqual([`Failed to read the account nonce on ${BASE.name}.`])
    })

    test('is null for an account that is not in the wallet or a network that is not enabled', async () => {
      const { accountsCtrl, fetches } = ctrl

      expect(await accountsCtrl.getLatestAccountNonce(ADDR_A, 12345n)).toBeNull()
      expect(
        await accountsCtrl.getLatestAccountNonce(
          '0x0000000000000000000000000000000000000001',
          BASE.chainId
        )
      ).toBeNull()
      expect(fetches).toHaveLength(0)
    })
  })
})

describe('AccountsController nonce reservations', () => {
  let ctrl: Awaited<ReturnType<typeof makeAccountsController>>
  const CHAIN = BASE.chainId
  const RESERVATION_TIMEOUT_MS = ACCOUNT_OP_PENDING_TIMEOUT_MS
  const op = (id: string, status: AccountOpStatus, overrides: Partial<SubmittedAccountOp> = {}) =>
    ({
      id,
      status,
      accountAddr: ADDR_A,
      chainId: CHAIN,
      calls: [],
      identifiedBy: { type: 'Transaction', identifier: '0x01' },
      ...overrides
    }) as SubmittedAccountOp
  const sender = (nonce: bigint, addr = ADDR_A) => ({ kind: 'sender' as const, addr, nonce })
  const account = (nonce: bigint, addr = ADDR_A) => ({ kind: 'account' as const, addr, nonce })
  /** Runs a state read of `addr` on CHAIN and answers it with `nonce` as both of its nonces */
  const readState = async (
    addr: string,
    nonce: bigint,
    blockTag: 'latest' | 'pending' = 'latest'
  ) => {
    const read = ctrl.accountsCtrl.updateAccountState(addr, blockTag, [CHAIN], true)
    await flushPromises()
    ctrl.fetches.at(-1)!.resolve([makeAccountState(addr, nonce)])
    await read
  }

  const useFakeTimers = () => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
  /**
   * Starts a new controller on the storage of the current one. Built with real timers, as its
   * identity intervals are not part of what these tests check.
   */
  const restart = async () => {
    const now = Date.now()
    jest.useRealTimers()
    jest.spyOn(Date, 'now').mockReturnValue(now)
    const restarted = await makeAccountsController({ storage: ctrl.storage })
    await flushPromises()
    return restarted.accountsCtrl
  }

  beforeEach(async () => {
    ctrl = await makeAccountsController()
    useFakeTimers()
  })

  afterEach(() => {
    const pendingTimerCount = jest.getTimerCount()
    jest.useRealTimers()
    jest.restoreAllMocks()
    expect(pendingTimerCount).toBe(0)
  })

  test('a new op skips the reserved nonces of its sender, kind and chain only', async () => {
    const { accountsCtrl } = ctrl
    await accountsCtrl.reserveNonces('a', CHAIN, [sender(7n), sender(8n)])
    await accountsCtrl.reserveNonces('b', CHAIN, [account(3n), sender(20n, ADDR_B)])
    await accountsCtrl.reserveNonces('c', ETHEREUM.chainId, [sender(30n)])

    expect(accountsCtrl.getNextNonce(ADDR_A.toLowerCase(), CHAIN, 'sender', 7n)).toBe(9n)
    // The RPC already counts the reserved nonces
    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 10n)).toBe(10n)
    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'account', 3n)).toBe(4n)
    expect(accountsCtrl.getNextNonce(ADDR_A, ETHEREUM.chainId, 'sender', 7n)).toBe(31n)
    expect(accountsCtrl.getNextNonce(ADDR_B, ETHEREUM.chainId, 'sender', 5n)).toBe(5n)
  })

  test('keeps the nonce of a confirmed op until a latest read counts it', async () => {
    const { accountsCtrl } = ctrl
    await accountsCtrl.reserveNonces('a', CHAIN, [sender(7n)])
    await accountsCtrl.settleNonceReservations([op('a', AccountOpStatus.Success)])

    // A lagging RPC still returns the nonce from before the op
    await readState(ADDR_A, 7n)
    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(8n)

    // A pending state can count a txn that is dropped later, so it frees nothing
    await readState(ADDR_A, 8n, 'pending')
    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(8n)

    await readState(ADDR_A, 8n)
    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(7n)
  })

  test('a latest read that counts a nonce does not free the reservation of a pending op', async () => {
    const { accountsCtrl } = ctrl
    await accountsCtrl.reserveNonces('pending', CHAIN, [sender(7n)])

    await readState(ADDR_A, 8n)

    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 6n)).toBe(8n)
    expect(
      accountsCtrl.getPendingNonceReservations(CHAIN, [{ kind: 'sender', addr: ADDR_A }])
    ).toEqual([{ accountOpId: 'pending', reserved: sender(7n) }])
  })

  test.each([AccountOpStatus.Rejected, AccountOpStatus.BroadcastButStuck])(
    'an op that becomes %s frees its nonces at once, without a read',
    async (status) => {
      const { accountsCtrl, fetches } = ctrl
      await accountsCtrl.reserveNonces('a', CHAIN, [sender(7n), account(3n)])

      await accountsCtrl.settleNonceReservations([op('a', status)])

      expect(fetches).toHaveLength(0)
      expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(7n)
      expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'account', 3n)).toBe(3n)
    }
  )

  test('a failed op frees the account nonce its revert undid and keeps the sender nonce', async () => {
    const { accountsCtrl } = ctrl
    await accountsCtrl.reserveNonces('a', CHAIN, [sender(7n, ADDR_B), account(3n)])

    await accountsCtrl.settleNonceReservations([op('a', AccountOpStatus.Failure)])

    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'account', 3n)).toBe(3n)
    expect(accountsCtrl.getNextNonce(ADDR_B, CHAIN, 'sender', 7n)).toBe(8n)
    // Settled, so it no longer holds a new op back
    expect(
      accountsCtrl.getPendingNonceReservations(CHAIN, [{ kind: 'sender', addr: ADDR_B }])
    ).toEqual([])

    await readState(ADDR_B, 8n)
    expect(accountsCtrl.getNextNonce(ADDR_B, CHAIN, 'sender', 7n)).toBe(7n)
  })

  test('a batch sent one txn at a time keeps only the nonces of its mined txns', async () => {
    const { accountsCtrl } = ctrl
    await accountsCtrl.reserveNonces('a', CHAIN, [sender(7n), sender(8n), sender(9n)])
    const minedCall = { to: ADDR_B, value: 0n, data: '0x', status: AccountOpStatus.Success }
    const droppedCall = { ...minedCall, status: AccountOpStatus.Rejected }
    // The batch takes the status of its last txn, though its first one was mined
    const batch = op('a', AccountOpStatus.Rejected, {
      identifiedBy: { type: 'MultipleTxns', identifier: '0x01-0x02-0x03' },
      calls: [minedCall, droppedCall, droppedCall]
    })

    await accountsCtrl.settleNonceReservations([batch])

    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(8n)
    await readState(ADDR_A, 8n)
    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(7n)
  })

  test('removing an account frees its nonces', async () => {
    const { accountsCtrl } = ctrl
    await accountsCtrl.reserveNonces('a', CHAIN, [sender(7n), sender(20n, ADDR_B)])

    accountsCtrl.removeAccountData(ADDR_A)

    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(7n)
    expect(accountsCtrl.getNextNonce(ADDR_B, CHAIN, 'sender', 20n)).toBe(21n)
  })

  test('the reservations survive a restart', async () => {
    const { accountsCtrl } = ctrl
    await accountsCtrl.reserveNonces('pending', CHAIN, [sender(7n)])
    await accountsCtrl.reserveNonces('confirmed', CHAIN, [account(3n)])
    await accountsCtrl.settleNonceReservations([op('confirmed', AccountOpStatus.Success)])
    await flushPromises()

    const restartedCtrl = await restart()

    expect(restartedCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(8n)
    expect(restartedCtrl.getNextNonce(ADDR_A, CHAIN, 'account', 3n)).toBe(4n)
    // Only the unsettled reservation holds a new op back
    expect(
      restartedCtrl.getPendingNonceReservations(CHAIN, [
        { kind: 'sender', addr: ADDR_A },
        { kind: 'account', addr: ADDR_A }
      ])
    ).toEqual([{ accountOpId: 'pending', reserved: sender(7n) }])
  })

  test('a reservation made while the controller loads is kept with the saved ones', async () => {
    await ctrl.accountsCtrl.reserveNonces('saved', CHAIN, [sender(7n)])
    await flushPromises()
    jest.useRealTimers()

    const { accountsCtrl } = await makeAccountsController({
      storage: ctrl.storage,
      shouldWaitForLoad: false
    })
    const reservingDuringLoad = accountsCtrl.reserveNonces('sent-during-load', CHAIN, [sender(8n)])
    await accountsCtrl.initialLoadPromise
    await reservingDuringLoad
    await flushPromises()

    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(9n)
    expect(Object.keys(await ctrl.storage.get('nonceReservations', {})).sort()).toEqual([
      'saved',
      'sent-during-load'
    ])
  })

  test('a reservation of a pending op holds its nonce for as long as the op is pending', async () => {
    const { accountsCtrl } = ctrl
    await accountsCtrl.reserveNonces('a', CHAIN, [sender(7n)])
    await flushPromises()

    jest.advanceTimersByTime(RESERVATION_TIMEOUT_MS * 4)

    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(8n)
    expect(
      accountsCtrl.getPendingNonceReservations(CHAIN, [{ kind: 'sender', addr: ADDR_A }])
    ).toEqual([{ accountOpId: 'a', reserved: sender(7n) }])
  })

  test('a settled reservation is ignored after the timeout from the settle, and dropped on the next load', async () => {
    const { accountsCtrl, storage } = ctrl
    await accountsCtrl.reserveNonces('a', CHAIN, [sender(7n)])
    // The op was pending for longer than the timeout, but a lagging RPC can still be behind it
    jest.advanceTimersByTime(RESERVATION_TIMEOUT_MS * 2)
    await accountsCtrl.settleNonceReservations([op('a', AccountOpStatus.Success)])
    await flushPromises()

    jest.advanceTimersByTime(RESERVATION_TIMEOUT_MS - 1)
    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(8n)

    jest.advanceTimersByTime(1)
    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(7n)

    await restart()
    expect(await storage.get('nonceReservations', {})).toEqual({})
  })

  test('drops the unsettled reservations whose op is not pending, and saves that', async () => {
    const { accountsCtrl, storage } = ctrl
    await accountsCtrl.reserveNonces('pending', CHAIN, [sender(7n)])
    await accountsCtrl.reserveNonces('untracked', CHAIN, [sender(8n)])
    await accountsCtrl.reserveNonces('confirmed', CHAIN, [account(3n)])
    await accountsCtrl.settleNonceReservations([op('confirmed', AccountOpStatus.Success)])
    jest.advanceTimersByTime(1)
    const loadStartedAt = Date.now()
    // Sent while Activity loads, so it is not in Activity yet
    await accountsCtrl.reserveNonces('sent-during-load', CHAIN, [sender(20n, ADDR_B)])

    await accountsCtrl.dropOrphanedNonceReservations(['pending'], loadStartedAt)
    await flushPromises()

    // Without the drop, the next op would take 9 and wait behind 8, which is never sent
    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'sender', 7n)).toBe(8n)
    // A settled reservation only waits for a read to count its nonce
    expect(accountsCtrl.getNextNonce(ADDR_A, CHAIN, 'account', 3n)).toBe(4n)
    expect(Object.keys(await storage.get('nonceReservations', {})).sort()).toEqual([
      'confirmed',
      'pending',
      'sent-during-load'
    ])
  })

  test('a reservation of an account removed from storage is dropped on load', async () => {
    const { accountsCtrl, storage } = ctrl
    await accountsCtrl.reserveNonces('a', CHAIN, [sender(7n), sender(20n, ADDR_B)])
    await flushPromises()
    await storage.set('accounts', [accounts[1]!])

    const restartedCtrl = await restart()

    expect(restartedCtrl.getNextNonce(ADDR_B, CHAIN, 'sender', 20n)).toBe(21n)
    expect(await storage.get('nonceReservations', {})).toEqual({
      a: expect.objectContaining({ nonces: [sender(20n, ADDR_B)] })
    })
  })
})

describe('AccountsController updateAccountPreferences replies', () => {
  const ADDR = accounts[0]!.addr
  const preferences = { label: 'Savings', pfp: ADDR }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('replies with success once the preferences are saved', async () => {
    const sendUiMessage = jest.fn()
    const { accountsCtrl, storage } = await makeAccountsController({ sendUiMessage })

    await accountsCtrl.updateAccountPreferences([{ addr: ADDR, preferences }], 'request-1')

    const savedAccounts: Account[] = await storage.get('accounts', [])
    expect(savedAccounts.find((a) => a.addr === ADDR)?.preferences.label).toBe('Savings')
    expect(sendUiMessage).toHaveBeenCalledTimes(1)
    expect(sendUiMessage).toHaveBeenCalledWith({ requestId: 'request-1', ok: true })
  })

  test('does not reply when called without a request id', async () => {
    const sendUiMessage = jest.fn()
    const { accountsCtrl } = await makeAccountsController({ sendUiMessage })

    await accountsCtrl.updateAccountPreferences([{ addr: ADDR, preferences }])

    expect(accountsCtrl.accounts.find((a) => a.addr === ADDR)?.preferences.label).toBe('Savings')
    expect(sendUiMessage).not.toHaveBeenCalled()
  })

  const getLabel = (ctrl: { accounts: Account[] }) =>
    ctrl.accounts.find((a) => a.addr === ADDR)?.preferences.label

  test('replies with the error and emits it silently when saving fails', async () => {
    const sendUiMessage = jest.fn()
    const { accountsCtrl, storage } = await makeAccountsController({ sendUiMessage })
    const emittedErrors: ErrorRef[] = []
    accountsCtrl.onError((error) => emittedErrors.push(error))
    jest.spyOn(storage, 'set').mockRejectedValueOnce(new Error('Storage is full'))

    await expect(
      accountsCtrl.updateAccountPreferences([{ addr: ADDR, preferences }], 'request-2')
    ).resolves.toBeUndefined()

    expect(sendUiMessage).toHaveBeenCalledTimes(1)
    expect(sendUiMessage).toHaveBeenCalledWith({
      requestId: 'request-2',
      ok: false,
      error: 'Storage is full'
    })
    // Silent, as the UI that asked tells the user itself
    expect(emittedErrors).toHaveLength(1)
    expect(emittedErrors[0]!.level).toBe('silent')
    expect(emittedErrors[0]!.error.message).toBe('Storage is full')
  })

  test('restores the previous preferences when saving fails', async () => {
    const { accountsCtrl, storage } = await makeAccountsController({ sendUiMessage: jest.fn() })
    const otherAddr = accounts[1]!.addr
    jest.spyOn(storage, 'set').mockRejectedValueOnce(new Error('Storage is full'))

    await accountsCtrl.updateAccountPreferences([{ addr: ADDR, preferences }], 'request-5')

    expect(getLabel(accountsCtrl)).toBe(DEFAULT_ACCOUNT_LABEL)
    // Accounts that weren't part of the update are left as they are
    expect(accountsCtrl.accounts.find((a) => a.addr === otherAddr)?.preferences.label).toBe(
      DEFAULT_ACCOUNT_LABEL
    )
  })

  test('shows the error when saving fails and there is no request to reply to', async () => {
    const sendUiMessage = jest.fn()
    const { accountsCtrl, storage } = await makeAccountsController({ sendUiMessage })
    const emittedErrors: ErrorRef[] = []
    accountsCtrl.onError((error) => emittedErrors.push(error))
    jest.spyOn(storage, 'set').mockRejectedValueOnce(new Error('Storage is full'))

    await expect(
      accountsCtrl.updateAccountPreferences([{ addr: ADDR, preferences }])
    ).resolves.toBeUndefined()

    expect(sendUiMessage).not.toHaveBeenCalled()
    expect(getLabel(accountsCtrl)).toBe(DEFAULT_ACCOUNT_LABEL)
    expect(emittedErrors).toHaveLength(1)
    expect(emittedErrors[0]!.level).toBe('major')
  })

  test('shows the error when saving fails and there is no way to reply', async () => {
    const { accountsCtrl, storage } = await makeAccountsController()
    const emittedErrors: ErrorRef[] = []
    accountsCtrl.onError((error) => emittedErrors.push(error))
    jest.spyOn(storage, 'set').mockRejectedValueOnce(new Error('Storage is full'))

    await expect(
      accountsCtrl.updateAccountPreferences([{ addr: ADDR, preferences }], 'request-4')
    ).resolves.toBeUndefined()

    expect(getLabel(accountsCtrl)).toBe(DEFAULT_ACCOUNT_LABEL)
    expect(emittedErrors).toHaveLength(1)
    expect(emittedErrors[0]!.level).toBe('major')
  })

  test('saves without replying when no way to reply was given', async () => {
    const { accountsCtrl } = await makeAccountsController()

    await expect(
      accountsCtrl.updateAccountPreferences([{ addr: ADDR, preferences }], 'request-3')
    ).resolves.toBeUndefined()
    expect(accountsCtrl.accounts.find((a) => a.addr === ADDR)?.preferences.label).toBe('Savings')
  })
})
