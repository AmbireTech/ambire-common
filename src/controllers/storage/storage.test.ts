import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { Storage } from '../../interfaces/storage'
import { StorageController } from './storage'

describe('StorageController', () => {
  const storage: Storage = produceMemoryStore()

  test('should init AccountsController', async () => {
    const storageCtrl = new StorageController(storage)
    expect(storageCtrl).toBeDefined()
  })
  test('test should get correct state from storage after storage.set', async () => {
    const storageCtrl = new StorageController(storage)
    storageCtrl.set('migrations', ['1'])
    storageCtrl.set('migrations', ['1', '2'])
    expect(await storageCtrl.get('migrations', [])).toEqual(['1', '2'])
    storageCtrl.set('migrations', ['1', '2', '3'])
    storageCtrl.set('migrations', ['1', '2', '3', '4'])
    expect(await storageCtrl.get('migrations', [])).toEqual(['1', '2', '3', '4'])
  })
  test('test should get correct state from storage after storage.remove', async () => {
    const storageCtrl = new StorageController(storage)
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
})
