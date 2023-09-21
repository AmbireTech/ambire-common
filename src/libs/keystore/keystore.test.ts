/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
/* eslint-disable max-classes-per-file */
import { describe, expect, test } from '@jest/globals'
import { decryptWithPrivateKey, createIdentity } from 'eth-crypto'

import { Wallet, ethers } from 'ethers'
import { KeystoreSigner } from 'libs/keystoreSigner/keystoreSigner'
import { Storage } from '../../interfaces/storage'
import { Key, Keystore } from './keystore'

// Helpers/testing
function produceMemoryStore(): Storage {
  const storage = new Map()
  return {
    get: (key, defaultValue): any => {
      const serialized = storage.get(key)
      return Promise.resolve(serialized ? JSON.parse(serialized) : defaultValue)
    },
    set: (key, value) => {
      storage.set(key, JSON.stringify(value))
      return Promise.resolve(null)
    }
  }
}

class InternalSigner {
  key

  privKey

  constructor(_key: Key, _privKey?: string) {
    this.key = _key
    this.privKey = _privKey
  }

  signRawTransaction() {
    return Promise.resolve('')
  }

  signTypedData() {
    return Promise.resolve('')
  }

  signMessage() {
    return Promise.resolve('')
  }
}

class LedgerSigner {
  // constructor(_key: Key) {}

  signRawTransaction() {
    return Promise.resolve('')
  }

  signTypedData() {
    return Promise.resolve('')
  }

  signMessage() {
    return Promise.resolve('')
  }
}

let keystore: Keystore
const keystoreSigners = { internal: InternalSigner, ledger: LedgerSigner }

describe('Keystore', () => {
  const pass = 'hoiHoi'
  const privKey = '207d56b2f2b06fd9c74562ec81f42d47393a55cfcf5c182605220ad7fdfbe600'
  const keyPublicAddress = '0xB6C923c6586eDb44fc4CC0AE4F60869271e75407'

  test('should initialize keystore', () => {
    keystore = new Keystore(produceMemoryStore(), keystoreSigners)
    expect((keystore as any)['#mainKey']).toBe(undefined)
  })

  test('should not unlock when empty', async () => {
    expect.assertions(1)
    try {
      await keystore.unlockWithSecret('passphrase', pass)
    } catch (e: any) {
      expect(e.message).toBe('keystore: no secrets yet')
    }
  })

  test('should not return uid until there are no secrets yet', async () => {
    try {
      await keystore.getKeyStoreUid()
    } catch (e: any) {
      expect(e.message).toBe('keystore: adding secret before get uid')
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
    } catch (e: any) {
      expect(e.message).toBe('keystore: secret playstation not found')
    }
  })

  test('should not unlock with wrong secret', async () => {
    expect.assertions(2)
    try {
      await keystore.unlockWithSecret('passphrase', `${pass}1`)
    } catch (e: any) {
      expect(e.message).toBe('keystore: wrong secret')
    }
    expect(keystore.isUnlocked()).toBe(false)
  })

  test('should unlock with secret', async () => {
    await keystore.unlockWithSecret('passphrase', pass)
    expect(keystore.isUnlocked()).toBe(true)
  })

  test('should add an internal key', async () => {
    expect.assertions(1)
    await keystore.addKey(privKey, 'test key')
    expect(await keystore.getKeys()).toHaveLength(1)
  })

  test('should get an internal signer', async () => {
    expect.assertions(2)
    const internalSigner: any = await keystore.getSigner(keyPublicAddress)
    expect(internalSigner.privKey).toEqual(privKey)
    expect(internalSigner.key.id).toEqual(keyPublicAddress)
  })

  test('should not get a signer', async () => {
    expect.assertions(1)
    try {
      await keystore.getSigner('0xc7E32B118989296eaEa88D86Bd9041Feca77Ed36')
    } catch (e: any) {
      expect(e.message).toBe('keystore: key not found')
    }
  })

  test('should throw not unlocked', async () => {
    expect.assertions(1)
    try {
      await keystore.lock()
      await keystore.getSigner(keyPublicAddress)
    } catch (e: any) {
      expect(e.message).toBe('keystore: not unlocked')
    }
  })

  test('should export key backup, create wallet and compare public address', async () => {
    await keystore.unlockWithSecret('passphrase', pass)
    const keyBackup = await keystore.exportKeyWithPasscode(keyPublicAddress, 'goshoPazara')
    const wallet = await Wallet.fromEncryptedJson(JSON.parse(keyBackup), 'goshoPazara')
    expect(wallet.address).toBe(keyPublicAddress)
  })

  test('should return uid', async () => {
    const keystoreUid = await keystore.getKeyStoreUid()
    expect(keystoreUid.length).toBe(128)
  })

  test('export Key With Public Key Encryption', async () => {
    const newDeviceKeyStore = createIdentity()
    const encryptedKey = await keystore.exportKeyWithPublicKeyEncryption(
      '0xB6C923c6586eDb44fc4CC0AE4F60869271e75407',
      newDeviceKeyStore.publicKey
    )
    const decryptedKey = await decryptWithPrivateKey(newDeviceKeyStore.privateKey, encryptedKey)
    expect(decryptedKey).toBe(privKey)
  })
})

describe('independant test', () => {
  beforeEach(() => {
    keystore = new Keystore(produceMemoryStore(), keystoreSigners)
  })
  test('import Key With Public Key Encryption', async () => {
    const label = 'new key'
    const keystore2 = new Keystore(produceMemoryStore(), keystoreSigners)
    await keystore2.addSecret('123', '123')
    await keystore2.unlockWithSecret('123', '123')
    const uid2 = await keystore2.getKeyStoreUid()

    await keystore.addSecret('a', 'b')
    await keystore.unlockWithSecret('a', 'b')
    const wallet = ethers.Wallet.createRandom()
    await keystore.addKey(wallet.privateKey.slice(2), label)
    const exported = await keystore.exportKeyWithPublicKeyEncryption(wallet.address, uid2)

    await keystore2.importKeyWithPublicKeyEncryption(exported, label)
    const signer = await keystore2.getSigner(wallet.address)
    expect(signer).toMatchObject({
      key: {
        id: wallet.address,
        isExternallyStored: false,
        label,
        type: 'internal',
        meta: null
      },
      privKey: wallet.privateKey.slice(2)
    })
  })
})
