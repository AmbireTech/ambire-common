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
    storageCtrl.set('testArray', [1])
    storageCtrl.set('testArray', [1, 2])
    expect(await storageCtrl.get('testArray', [])).toEqual([1, 2])
    storageCtrl.set('testArray', [1, 2, 3])
    storageCtrl.set('testArray', [1, 2, 3, 4])
    expect(await storageCtrl.get('testArray', [])).toEqual([1, 2, 3, 4])
  })
  test('test should get correct state from storage after storage.remove', async () => {
    const storageCtrl = new StorageController(storage)
    expect(await storageCtrl.get('testArray', [])).toEqual([1, 2, 3, 4])
    storageCtrl.remove('testArray')
    expect(await storageCtrl.get('testArray', [])).toEqual([])
  })
})
