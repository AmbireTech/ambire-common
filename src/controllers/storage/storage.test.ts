import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { Storage } from '../../interfaces/storage'
import { StorageController } from './storage'

const ALL_MIGRATION_KEYS = [
  'migrateNetworkPreferencesToNetworks',
  'migrateAccountPreferencesToAccounts',
  'migrateKeystoreSeedsWithoutHdPathTemplate',
  'migrateKeyPreferencesToKeystoreKeys',
  'migrateKeyMetaNullToKeyMetaCreatedAt',
  'clearHumanizerMetaObjectFromStorage',
  'migrateTokenPreferences',
  'removeDappSessions',
  'removeIsDefaultWalletStorageIfExist',
  'removeOnboardingStateStorageIfExist',
  'migrateNetworkIdToChainId',
  'migrateAccountsCleanupUsedOnNetworks',
  'migrateLegacyDappsToDappsV2',
  'cleanObsoleteNewlyCreatedFlagOnAccounts',
  'cleanupCashbackStatus',
  'removePhishingDetection',
  'removePhishingDetectionV2',
  'cleanUpEmailVaultStorage',
  'fixSelectedAccountDismissedBannerIdsType',
  'migrateDappsAddConnectionSources',
  'migrateDomainsCacheToNames'
]

// Wraps a memory store and counts how many times each key is read and how many
// writes/removes happen, so tests can assert the migration sweep is cheap.
function produceCountingStore() {
  const inner = produceMemoryStore()
  let getCounts: Record<string, number> = {}
  let setCount = 0
  let removeCount = 0

  const store: Storage = {
    get: ((key: string, defaultValue?: any) => {
      getCounts[key] = (getCounts[key] || 0) + 1
      return (inner.get as any)(key, defaultValue)
    }) as Storage['get'],
    set: (key, value) => {
      setCount += 1
      return inner.set(key, value)
    },
    remove: (key) => {
      removeCount += 1
      return inner.remove(key)
    }
  }

  return {
    store,
    reset() {
      getCounts = {}
      setCount = 0
      removeCount = 0
    },
    getCounts: () => getCounts,
    totalGets: () => Object.values(getCounts).reduce((a, b) => a + b, 0),
    setCount: () => setCount,
    removeCount: () => removeCount
  }
}

describe('StorageController', () => {
  test('should init StorageController', async () => {
    const storageCtrl = new StorageController(produceMemoryStore())
    expect(storageCtrl).toBeDefined()
  })
  test('test should get correct state from storage after storage.set', async () => {
    const storageCtrl = new StorageController(produceMemoryStore())
    storageCtrl.set('migrations', ['1'])
    storageCtrl.set('migrations', ['1', '2'])
    expect(await storageCtrl.get('migrations', [])).toEqual(['1', '2'])
    storageCtrl.set('migrations', ['1', '2', '3'])
    storageCtrl.set('migrations', ['1', '2', '3', '4'])
    expect(await storageCtrl.get('migrations', [])).toEqual(['1', '2', '3', '4'])
  })
  test('test should get correct state from storage after storage.remove', async () => {
    const storageCtrl = new StorageController(produceMemoryStore())
    storageCtrl.set('migrations', ['1', '2', '3', '4'])
    expect(await storageCtrl.get('migrations', [])).toEqual(['1', '2', '3', '4'])
    storageCtrl.remove('migrations')
    expect(await storageCtrl.get('migrations', [])).toEqual([])
  })

  describe('migrateDappsAddConnectionSources', () => {
    const legacyConnected = {
      id: 'legacy-connected.com',
      name: 'Legacy Connected',
      description: '',
      url: 'https://legacy-connected.com',
      icon: null,
      category: null,
      tvl: null,
      twitter: null,
      geckoId: null,
      chainIds: [1],
      isConnected: true,
      isFeatured: false,
      isCustom: true,
      chainId: 1,
      favorite: false,
      blacklisted: 'VERIFIED'
    }
    const legacyDisconnected = {
      ...legacyConnected,
      id: 'legacy-disconnected.com',
      name: 'Legacy Disconnected',
      url: 'https://legacy-disconnected.com',
      isConnected: false
    }

    test('seeds connectedSources from legacy isConnected and persists', async () => {
      const memStorage: Storage = produceMemoryStore()
      // Mark the earlier dapps migration as done so it doesn't wipe the dappsV2 we set up here.
      await memStorage.set('passedMigrations', ['migrateLegacyDappsToDappsV2'])
      await memStorage.set('dappsV2', [legacyConnected, legacyDisconnected])

      // Constructing the controller kicks off #loadMigrations; get() awaits it implicitly.
      const storageCtrl = new StorageController(memStorage)
      const migrated = await storageCtrl.get('dappsV2', [])

      const connected = (migrated as any[]).find((d) => d.id === 'legacy-connected.com')
      const disconnected = (migrated as any[]).find((d) => d.id === 'legacy-disconnected.com')
      expect(connected.connectedSources).toEqual(['injected'])
      expect(disconnected.connectedSources).toEqual([])

      const passed = await storageCtrl.get('passedMigrations', [])
      expect(passed).toContain('migrateDappsAddConnectionSources')
    })

    test('is a no-op for dapps that already have a consistent connectedSources', async () => {
      const memStorage: Storage = produceMemoryStore()
      await memStorage.set('passedMigrations', ['migrateLegacyDappsToDappsV2'])
      // isConnected: true is consistent with connectedSources: ['wc'] (length > 0), so untouched.
      const alreadyMigrated = { ...legacyConnected, connectedSources: ['wc'] }
      await memStorage.set('dappsV2', [alreadyMigrated])

      const storageCtrl = new StorageController(memStorage)
      const migrated = await storageCtrl.get('dappsV2', [])
      expect((migrated as any[])[0].connectedSources).toEqual(['wc'])
    })

    // BUG: a dapp that already had a connectedSources array but a stale isConnected (the two
    // drifted) used to slip through the migration untouched, leaving isConnected: true while
    // connectedSources: []. The UI shows it as connected (it reads isConnected) but permission
    // checks (which read connectedSources) force a reconnect on every request.
    test('reconciles a drifted record where isConnected disagrees with connectedSources', async () => {
      const memStorage: Storage = produceMemoryStore()
      await memStorage.set('passedMigrations', ['migrateLegacyDappsToDappsV2'])
      const drifted = { ...legacyConnected, isConnected: true, connectedSources: [] }
      await memStorage.set('dappsV2', [drifted])

      const storageCtrl = new StorageController(memStorage)
      const migrated = await storageCtrl.get('dappsV2', [])

      // connectedSources is the source of truth → empty means disconnected, isConnected follows.
      expect((migrated as any[])[0].connectedSources).toEqual([])
      expect((migrated as any[])[0].isConnected).toBe(false)
    })

    test('passedMigrations guard prevents the migration from running twice', async () => {
      const memStorage: Storage = produceMemoryStore()
      await memStorage.set('passedMigrations', ['migrateLegacyDappsToDappsV2'])
      await memStorage.set('dappsV2', [legacyConnected])

      // First boot: migration runs and seeds connectedSources.
      const first = new StorageController(memStorage)
      await first.get('dappsV2', [])
      const passed = await first.get('passedMigrations', [])
      expect(passed).toContain('migrateDappsAddConnectionSources')

      // Once recorded, the migration is skipped on the next boot — storage-level repair is
      // one-shot. The durable invariant guarantee for already-recorded installs is enforced at
      // read time in DappsController.#load (see dapps.test.ts), not by re-running this migration.
      const tampered = (await first.get('dappsV2', [])).map((d: any) => {
        const { connectedSources, ...rest } = d
        return rest
      })
      await first.set('dappsV2', tampered)

      const second = new StorageController(memStorage)
      const after = await second.get('dappsV2', [])
      expect((after as any[])[0].connectedSources).toBeUndefined()
    })
  })

  describe('migrateDomainsCacheToNames', () => {
    const ADDRESS = '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337'

    test('normalizes legacy per-service fields into the { names, avatar, expiry } shape', async () => {
      const memStorage: Storage = produceMemoryStore()
      await memStorage.set('domainsCache', {
        [ADDRESS]: {
          ens: 'elmoto.eth',
          namoshi: null,
          ensAvatar: 'https://something.com/avatar.png',
          updatedAt: 123
        }
      } as any)

      const storageCtrl = new StorageController(memStorage)
      const migrated: any = await storageCtrl.get('domainsCache', {})

      const entry = migrated[ADDRESS]
      expect(entry.names.ens).toBe('elmoto.eth')
      expect(entry.names.namoshi).toBe(null)
      expect(entry.avatar).toBe('https://something.com/avatar.png')
      expect(entry.updatedAt).toBe(123)
      // Legacy fields are gone after the migration.
      expect('ens' in entry).toBe(false)
      expect('ensAvatar' in entry).toBe(false)

      const passed = await storageCtrl.get('passedMigrations', [])
      expect(passed).toContain('migrateDomainsCacheToNames')
    })

    test('leaves an already-migrated entry untouched', async () => {
      const memStorage: Storage = produceMemoryStore()
      const current = {
        [ADDRESS]: {
          names: { ens: 'elmoto.eth', namoshi: null },
          avatar: null,
          createdAt: 1,
          updatedAt: 2
        }
      }
      await memStorage.set('domainsCache', current as any)

      const storageCtrl = new StorageController(memStorage)
      const migrated = await storageCtrl.get('domainsCache', {})
      expect(migrated).toEqual(current)
    })
  })

  describe('migration sweep performance', () => {
    test('a fully-migrated install reads only `passedMigrations` once and writes nothing', async () => {
      const counting = produceCountingStore()
      // Simulate an existing install where every migration has already run.
      await counting.store.set('passedMigrations', ALL_MIGRATION_KEYS)
      counting.reset()

      const storageCtrl = new StorageController(counting.store)
      // Awaiting any public get drains the migration sweep, then issues exactly
      // one extra `passedMigrations` read of its own.
      await storageCtrl.get('passedMigrations', [])

      // The sweep itself must not touch any data key, set, or remove anything.
      // 2 reads = 1 from the sweep + 1 from the get() above.
      expect(counting.getCounts().passedMigrations).toBe(2)
      expect(counting.totalGets()).toBe(2)
      expect(counting.setCount()).toBe(0)
      expect(counting.removeCount()).toBe(0)
    })

    test('a fresh install records every migration, then later boots become a single read', async () => {
      const counting = produceCountingStore()

      // First boot on an empty store: every migration runs (mostly no-ops on
      // empty data) and records itself in `passedMigrations`.
      const first = new StorageController(counting.store)
      const passed = await first.get('passedMigrations', [])
      expect([...passed].sort()).toEqual([...ALL_MIGRATION_KEYS].sort())

      // Second boot on the now-migrated store must be as cheap as the steady
      // state: one `passedMigrations` read by the sweep, no other reads/writes.
      counting.reset()
      const second = new StorageController(counting.store)
      await second.get('passedMigrations', [])

      expect(counting.getCounts().passedMigrations).toBe(2)
      expect(counting.totalGets()).toBe(2)
      expect(counting.setCount()).toBe(0)
      expect(counting.removeCount()).toBe(0)
    })

    test('the newly-guarded migrations do not run again once recorded', async () => {
      // These four previously had no `passedMigrations` guard and so read (and
      // some wrote) on every boot. Once recorded they must be skipped entirely.
      const counting = produceCountingStore()
      await counting.store.set('passedMigrations', ALL_MIGRATION_KEYS)
      counting.reset()

      const storageCtrl = new StorageController(counting.store)
      await storageCtrl.get('passedMigrations', [])

      // migrateKeyMetaNullToKeyMetaCreatedAt -> keystoreKeys (used to write it)
      expect(counting.getCounts().keystoreKeys).toBeUndefined()
      // removeIsDefaultWalletStorageIfExist -> isDefaultWallet
      expect(counting.getCounts().isDefaultWallet).toBeUndefined()
      // removeOnboardingStateStorageIfExist -> onboardingState
      expect(counting.getCounts().onboardingState).toBeUndefined()
      // clearHumanizerMetaObjectFromStorage -> HumanizerMetaV2 (used to remove it)
      expect(counting.setCount()).toBe(0)
      expect(counting.removeCount()).toBe(0)
    })
  })
})
