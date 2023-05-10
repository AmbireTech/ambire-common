import { Keystore, Storage } from '../../v2/libs/keystore/keystore'
import { assertion, expect } from '../config'

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
  it('should initialize keystore', () => {
    keystore = new Keystore(produceMemoryStore())
    expect((keystore as any)['#mainKey']).to.equal(undefined)
  })

  it('should not unlock when empty', async () => {
    assertion.expectExpects(1)
    try {
      await keystore.unlockWithSecret('passphrase', pass)
    } catch(e: any) {
      expect(e.message).to.equal('keystore: no secrets yet')
    }
  })

  it('should add a secret', async () => {
    await keystore.addSecret('passphrase', pass)
    expect(keystore.isUnlocked()).to.equal(false)
  })

  it('should not unlock with non-existant secret', async () => {
    assertion.expectExpects(1)
    try {
      await keystore.unlockWithSecret('playstation', '')
    } catch(e: any) {
      expect(e.message).to.equal('keystore: secret playstation not found')
    }
  })

  it('should not unlock with wrong secret', async () => {
    assertion.expectExpects(2)
    try {
      await keystore.unlockWithSecret('passphrase', pass+'1')
    } catch(e: any) {
      expect(e.message).to.equal('keystore: wrong secret')
    }
    expect(keystore.isUnlocked()).to.equal(false)
  })

  it('should unlock with secret', async () => {
  	await keystore.unlockWithSecret('passphrase', pass)
    expect(keystore.isUnlocked()).to.equal(true)
  })

  // @TODO: secret not found
})
