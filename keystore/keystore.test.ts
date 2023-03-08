import { Keystore, Storage } from './keystore'
import { describe, expect, test } from '@jest/globals'


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

describe('Keystore', () => {
  let keystore: Keystore
  const pass = 'hoiHoi'
  test('initialize keystore', () => {
    keystore = new Keystore(produceMemoryStore())
    expect((keystore as any)['#mainKey']).toBe(undefined)
  })

  test('does not unlock when empty', async () => {
    expect.assertions(1)
    try {
      await keystore.unlockWithSecret('passphrase', pass)
    } catch(e) {
      expect(e).toThrowError('keystore: no secrets yet')
    }
  })

  test('add secret', async () => {
    await keystore.addSecret('passphrase', pass)
    expect(keystore.isUnlocked()).toBe(false)
  })

  test('cannot unlock with non-existant secret', async () => {
    expect.assertions(1)
    try {
      await keystore.unlockWithSecret('playstation', '')
    } catch(e) {
      expect(e).toThrowError('keystore: secret playstation not found')
    }
  })

  test('cannot unlock with wrong secret', async () => {
    expect.assertions(1)
    try {
      await keystore.unlockWithSecret('passphrase', pass+'1')
    } catch(e) {
      expect(e).toThrowError('keystore: wrong secret')
    }
    expect(keystore.isUnlocked()).toBe(false)
  })

  test('unlock with secret', async () => {
  	await keystore.unlockWithSecret('passphrase', pass)
    expect(keystore.isUnlocked()).toBe(true)
  })

  // @TODO: secret not found
})
