/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
import { Wallet, ethers } from 'ethers'

/* eslint-disable max-classes-per-file */
import { describe, expect, test } from '@jest/globals'
import { decryptWithPrivateKey, createIdentity } from 'eth-crypto'

import { Storage } from '../../interfaces/storage'
import { produceMemoryStore } from '../../../test/helpers'
import { Key, Keystore } from './keystore'

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
    await keystore.addKeys([{ privateKey: privKey, label: 'test key' }])

    const keys = await keystore.getKeys()
    expect(keys).toContainEqual(
      expect.objectContaining({ addr: keyPublicAddress, type: 'internal' })
    )
  })

  test('should not add twice internal key that is already added', async () => {
    const keysWithPrivateKeyAlreadyAdded = [
      { privateKey: privKey, label: 'test key 1' },
      { privateKey: privKey, label: 'test key 2 with the same private key as test key 1' }
    ]

    const anotherPrivateKeyNotAddedYet =
      '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
    const anotherPrivateKeyPublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'
    const keysWithPrivateKeyDuplicatedInParams = [
      { privateKey: anotherPrivateKeyNotAddedYet, label: 'test key 3' },
      {
        privateKey: anotherPrivateKeyNotAddedYet,
        label: 'test key 4 with the same private key as key 3'
      }
    ]

    expect.assertions(1)
    await keystore.addKeys([
      ...keysWithPrivateKeyAlreadyAdded,
      ...keysWithPrivateKeyDuplicatedInParams
    ])

    const keys = await keystore.getKeys()
    const newKeys = keys.filter(
      (x) =>
        [anotherPrivateKeyPublicAddress, keyPublicAddress].includes(x.addr) && x.type === 'internal'
    )

    expect(newKeys).toHaveLength(2)
  })

  test('should add an external key', async () => {
    const publicAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    expect.assertions(1)
    await keystore.addKeysExternallyStored([
      { addr: publicAddress, label: 'test external key', type: 'trezor', meta: null }
    ])

    const keys = await keystore.getKeys()
    expect(keys).toContainEqual(expect.objectContaining({ addr: publicAddress, type: 'trezor' }))
  })

  test('should not add twice external key that is already added', async () => {
    const publicAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    const keysWithPrivateKeyAlreadyAdded = [
      { addr: publicAddress, label: 'test key 1', type: 'trezor' as 'trezor', meta: null },
      {
        addr: publicAddress,
        label: 'test key 2 with the same id (public address) as test key 1',
        type: 'trezor' as 'trezor',
        meta: null
      }
    ]

    const anotherAddressNotAddedYet = '0x42c06A1722DEb11022A339d3448BafFf8dFF99Ac'
    const keysWithPrivateKeyDuplicatedInParams = [
      {
        addr: anotherAddressNotAddedYet,
        label: 'test key 3',
        type: 'trezor' as 'trezor',
        meta: null
      },
      {
        addr: anotherAddressNotAddedYet,
        label: 'test key 4 with the same private key as key 3',
        type: 'trezor' as 'trezor',
        meta: null
      }
    ]

    expect.assertions(1)
    await keystore.addKeysExternallyStored([
      ...keysWithPrivateKeyAlreadyAdded,
      ...keysWithPrivateKeyDuplicatedInParams
    ])

    const keys = await keystore.getKeys()
    const newKeys = keys
      .map(({ addr }) => addr)
      .filter((addr) => [publicAddress, anotherAddressNotAddedYet].includes(addr))

    expect(newKeys).toHaveLength(2)
  })

  test('should add both keys when they have the same address but different type', async () => {
    const externalKeysToAddWithDuplicateOnes = [
      { addr: keyPublicAddress, label: 'test key 2', type: 'trezor' as 'trezor', meta: null },
      { addr: keyPublicAddress, label: 'test key 2', type: 'trezor' as 'trezor', meta: null },
      { addr: keyPublicAddress, label: 'test key 3', type: 'ledger' as 'ledger', meta: null }
    ]

    expect.assertions(3)
    await keystore.addKeysExternallyStored(externalKeysToAddWithDuplicateOnes)

    const keys = await keystore.getKeys()

    expect(keys.filter((x) => x.addr === keyPublicAddress && x.type === 'trezor').length).toEqual(1)
    expect(keys.filter((x) => x.addr === keyPublicAddress && x.type === 'ledger').length).toEqual(1)
    // Note: previous test adds internal key with the same address
    expect(keys.filter((x) => x.addr === keyPublicAddress && x.type === 'internal').length).toEqual(
      1
    )
  })

  test('should get an internal signer', async () => {
    expect.assertions(2)
    const internalSigner: any = await keystore.getSigner(keyPublicAddress, 'internal')
    expect(internalSigner.privKey).toEqual(privKey)
    expect(internalSigner.key.addr).toEqual(keyPublicAddress)
  })

  test('should not get a signer', async () => {
    expect.assertions(1)
    try {
      await keystore.getSigner('0xc7E32B118989296eaEa88D86Bd9041Feca77Ed36', 'internal')
    } catch (e: any) {
      expect(e.message).toBe('keystore: key not found')
    }
  })

  test('should throw not unlocked', async () => {
    expect.assertions(1)
    try {
      await keystore.lock()
      await keystore.getSigner(keyPublicAddress, 'internal')
    } catch (e: any) {
      expect(e.message).toBe('keystore: not unlocked')
    }
  })

  test('should export key backup, create wallet and compare public address', async () => {
    await keystore.unlockWithSecret('passphrase', pass)
    const keyBackup = await keystore.exportKeyWithPasscode(
      keyPublicAddress,
      'internal',
      'goshoPazara'
    )
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
    console.log('in test')
    const label = 'new key'
    const keystore2 = new Keystore(produceMemoryStore(), keystoreSigners)
    await keystore2.addSecret('123', '123')
    await keystore2.unlockWithSecret('123', '123')
    const uid2 = await keystore2.getKeyStoreUid()

    await keystore.addSecret('a', 'b')
    await keystore.unlockWithSecret('a', 'b')
    const wallet = ethers.Wallet.createRandom()
    await keystore.addKeys([{ privateKey: wallet.privateKey.slice(2), label }])
    const exported = await keystore.exportKeyWithPublicKeyEncryption(wallet.address, uid2)

    await keystore2.importKeyWithPublicKeyEncryption(exported, label)
    const signer = await keystore2.getSigner(wallet.address, 'internal')
    expect(signer).toMatchObject({
      key: {
        addr: wallet.address,
        isExternallyStored: false,
        label,
        type: 'internal',
        meta: null
      },
      privKey: wallet.privateKey.slice(2)
    })
  })
})
