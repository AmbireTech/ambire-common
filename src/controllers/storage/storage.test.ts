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

    test('is a no-op for dapps that already have connectedSources', async () => {
      const memStorage: Storage = produceMemoryStore()
      const alreadyMigrated = { ...legacyConnected, connectedSources: ['wc'] }
      await memStorage.set('dappsV2', [alreadyMigrated])

      const storageCtrl = new StorageController(memStorage)
      const migrated = await storageCtrl.get('dappsV2', [])
      expect((migrated as any[])[0].connectedSources).toEqual(['wc'])
    })

    test('does not run twice — the second construction is a no-op', async () => {
      const memStorage: Storage = produceMemoryStore()
      await memStorage.set('dappsV2', [legacyConnected])

      // First boot: migration runs and seeds connectedSources.
      const first = new StorageController(memStorage)
      await first.get('dappsV2', [])

      // Simulate downstream code stripping connectedSources. The migration must NOT
      // re-seed on the next boot because it's recorded in passedMigrations.
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
