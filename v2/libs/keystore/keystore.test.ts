import { Keystore } from './keystore'
import { describe, expect, test } from '@jest/globals'
import { Storage } from '../../interfaces/storage'

// Helpers/testing
function produceMemoryStore(): Storage {
	const storage = new Map()
	return {
		get: (key, defaultValue): any => {
			const serialized = storage.get(key)
			return  Promise.resolve(serialized ? JSON.parse(serialized) : defaultValue)
		},
		set: (key, value) => { storage.set(key, JSON.stringify(value)); return Promise.resolve(null) }
	}
}

let keystore: Keystore
const pass = 'hoiHoi'

describe('Keystore', () => {
  test('should initialize keystore', () => {
    keystore = new Keystore(produceMemoryStore())
    expect((keystore as any)['#mainKey']).toBe(undefined)
  })

  test('should not unlock when empty', async () => {
    expect.assertions(1)
    try {
      await keystore.unlockWithSecret('passphrase', pass)
    } catch(e: any) {
      expect(e.message).toBe('keystore: no secrets yet')
    }
  })

  test('should add a secret', async () => {
    await keystore.addSecret('passphrase', pass)
    expect(keystore.isUnlocked()).toBe(false)
  })

  test('should not unlock with non-existant secret', async () => {
    expect.assertions(1)
    try {
      await keystore.unlockWithSecret('playstation', '')
    } catch(e: any) {
      expect(e.message).toBe('keystore: secret playstation not found')
    }
  })

  test('should not unlock with wrong secret', async () => {
    expect.assertions(2)
    try {
      await keystore.unlockWithSecret('passphrase', pass+'1')
    } catch(e: any) {
      expect(e.message).toBe('keystore: wrong secret')
    }
    expect(keystore.isUnlocked()).toBe(false)
  })

  test('should unlock with secret', async () => {
  	await keystore.unlockWithSecret('passphrase', pass)
    expect(keystore.isUnlocked()).toBe(true)
  })

  // @TODO: secret not found
})
