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
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import * as accountStateLib from '../../libs/accountState/accountState'
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
const makeAccountsController = async () => {
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

  const storage = new StorageController(produceMemoryStore())
  await storage.set('accounts', accounts)
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
    } as unknown as IFeatureFlagsController
  )
  await accountsCtrl.initialLoadPromise
  await accountsCtrl.accountStateInitialLoadPromise
  const errors: string[] = []
  accountsCtrl.onError((error) => errors.push(error.message))

  return { accountsCtrl, fetches, errors, updateProviderIsWorking }
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
})
