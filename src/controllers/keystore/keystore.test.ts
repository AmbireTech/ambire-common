/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
/* eslint-disable max-classes-per-file */

import { Wallet } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { Key } from '../../interfaces/keystore'
import { KeystoreController } from './keystore'

export class InternalSigner {
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
  key

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(_key: Key) {
    this.key = _key
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

let keystore: KeystoreController
const pass = 'hoiHoi'
const keystoreSigners = { internal: InternalSigner, ledger: LedgerSigner }
const privKey = '207d56b2f2b06fd9c74562ec81f42d47393a55cfcf5c182605220ad7fdfbe600'
const keyPublicAddress = '0xB6C923c6586eDb44fc4CC0AE4F60869271e75407'

describe('KeystoreController', () => {
  const storage = produceMemoryStore()
  test('should initialize', () => {
    keystore = new KeystoreController(storage, keystoreSigners)
    expect(keystore).toBeDefined()
  })

  test('should not unlock with non-existent secret (when no secrets exist)', (done) => {
    keystore.unlockWithSecret('password', pass)

    const unsubscribe = keystore.onError((e) => {
      expect(e.error.message).toBe('keystore: no secrets yet')
      expect(keystore.isUnlocked).toBe(false)

      unsubscribe()
    })

    const unsubscribeUpdate = keystore.onUpdate(async () => {
      if (keystore.latestMethodCall === 'unlockWithSecret' && keystore.status === 'DONE') {
        unsubscribeUpdate()
        done()
      }
    })
  })

  test('should throw an error if trying to get uid before adding secrets', () => {
    expect(keystore.getKeyStoreUid()).rejects.toThrow('keystore: adding secret before get uid')
  })

  test('should add a secret', (done) => {
    keystore.addSecret('password', pass, '', false)

    const unsubscribe = keystore.onUpdate(async () => {
      if (keystore.latestMethodCall === 'addSecret' && keystore.status === 'DONE') {
        expect(keystore.isUnlocked).toBe(false)
        expect(await keystore.isReadyToStoreKeys).toBe(true)

        unsubscribe()
        done()
      }
    })
  })

  test('should not unlock with non-existent secret (when secrets exist)', (done) => {
    keystore.unlockWithSecret('playstation', '')

    const unsubscribe = keystore.onError((e) => {
      expect(e.error.message).toBe('keystore: secret not found: playstation')
      expect(keystore.isUnlocked).toBe(false)

      unsubscribe()
    })

    const unsubscribeUpdate = keystore.onUpdate(async () => {
      if (keystore.latestMethodCall === 'unlockWithSecret' && keystore.status === 'DONE') {
        unsubscribeUpdate()
        done()
      }
    })
  })

  test('should not unlock with wrong secret', async () => {
    try {
      await keystore.unlockWithSecret('password', `${pass}1`)
    } catch {
      expect(keystore.errorMessage).toBe('keystore: wrong secret')
    }
  })

  test('should unlock with secret', (done) => {
    keystore.unlockWithSecret('password', pass)

    const unsubscribe = keystore.onUpdate(async () => {
      if (keystore.latestMethodCall === 'unlockWithSecret' && keystore.status === 'DONE') {
        expect(keystore.isUnlocked).toBe(true)

        unsubscribe()
        done()
      }
    })
  })

  test('should add an internal key', (done) => {
    keystore.addKeys([{ privateKey: privKey, dedicatedToOneSA: true }])

    const unsubscribe = keystore.onUpdate(async () => {
      if (keystore.latestMethodCall === 'addKeys' && keystore.status === 'DONE') {
        expect(keystore.keys).toContainEqual(
          expect.objectContaining({ addr: keyPublicAddress, type: 'internal' })
        )

        unsubscribe()
        done()
      }
    })
  })

  test('should not add twice internal key that is already added', (done) => {
    // two keys with the same private key
    const keysWithPrivateKeyAlreadyAdded = [
      { privateKey: privKey, dedicatedToOneSA: true },
      { privateKey: privKey, dedicatedToOneSA: true }
    ]

    const anotherPrivateKeyNotAddedYet =
      '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
    const anotherPrivateKeyPublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'
    const keysWithPrivateKeyDuplicatedInParams = [
      // test key 3
      { privateKey: anotherPrivateKeyNotAddedYet, dedicatedToOneSA: false },
      // test key 4 with the same private key as key 3
      { privateKey: anotherPrivateKeyNotAddedYet, dedicatedToOneSA: false }
    ]

    keystore.addKeys([...keysWithPrivateKeyAlreadyAdded, ...keysWithPrivateKeyDuplicatedInParams])

    const unsubscribe = keystore.onUpdate(async () => {
      if (keystore.latestMethodCall === 'addKeys' && keystore.status === 'DONE') {
        const newKeys = keystore.keys.filter(
          (x) =>
            [anotherPrivateKeyPublicAddress, keyPublicAddress].includes(x.addr) &&
            x.type === 'internal'
        )
        expect(newKeys).toHaveLength(2)

        unsubscribe()
        done()
      }
    })
  })

  test('should add an external key', (done) => {
    const publicAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

    keystore.addKeysExternallyStored([
      { addr: publicAddress, dedicatedToOneSA: true, type: 'trezor', meta: null }
    ])

    const unsubscribe = keystore.onUpdate(async () => {
      if (keystore.latestMethodCall === 'addKeysExternallyStored' && keystore.status === 'DONE') {
        expect(keystore.keys).toContainEqual(
          expect.objectContaining({ addr: publicAddress, type: 'trezor' })
        )

        unsubscribe()
        done()
      }
    })
  })

  test('should not add twice external key that is already added', (done) => {
    const publicAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    const keysWithPrivateKeyAlreadyAdded = [
      // test key 1
      { addr: publicAddress, type: 'trezor' as 'trezor', dedicatedToOneSA: true, meta: null },
      // test key 2 with the same id (public address) as test key 1'
      {
        addr: publicAddress,
        type: 'trezor' as 'trezor',
        dedicatedToOneSA: true,
        meta: null
      }
    ]

    const anotherAddressNotAddedYet = '0x42c06A1722DEb11022A339d3448BafFf8dFF99Ac'
    const keysWithPrivateKeyDuplicatedInParams = [
      // test key 3
      {
        addr: anotherAddressNotAddedYet,
        type: 'trezor' as 'trezor',
        dedicatedToOneSA: true,
        meta: null
      },
      // test key 4 with the same private key as key 3',
      {
        addr: anotherAddressNotAddedYet,
        type: 'trezor' as 'trezor',
        dedicatedToOneSA: true,
        meta: null
      }
    ]

    keystore.addKeysExternallyStored([
      ...keysWithPrivateKeyAlreadyAdded,
      ...keysWithPrivateKeyDuplicatedInParams
    ])

    const unsubscribe = keystore.onUpdate(async () => {
      if (keystore.latestMethodCall === 'addKeysExternallyStored' && keystore.status === 'DONE') {
        const newKeys = keystore.keys
          .map(({ addr }) => addr)
          .filter((addr) => [publicAddress, anotherAddressNotAddedYet].includes(addr))

        expect(newKeys).toHaveLength(2)

        unsubscribe()
        done()
      }
    })
  })

  test('should add both keys when they have the same address but different type', (done) => {
    const externalKeysToAddWithDuplicateOnes = [
      { addr: keyPublicAddress, type: 'trezor' as 'trezor', dedicatedToOneSA: true, meta: null },
      { addr: keyPublicAddress, type: 'trezor' as 'trezor', dedicatedToOneSA: true, meta: null },
      { addr: keyPublicAddress, type: 'ledger' as 'ledger', dedicatedToOneSA: true, meta: null }
    ]

    keystore.addKeysExternallyStored(externalKeysToAddWithDuplicateOnes)

    const unsubscribe = keystore.onUpdate(async () => {
      if (keystore.latestMethodCall === 'addKeysExternallyStored' && keystore.status === 'DONE') {
        expect(
          keystore.keys.filter((x) => x.addr === keyPublicAddress && x.type === 'trezor').length
        ).toEqual(1)
        expect(
          keystore.keys.filter((x) => x.addr === keyPublicAddress && x.type === 'ledger').length
        ).toEqual(1)
        // Note: previous test adds internal key with the same address
        expect(
          keystore.keys.filter((x) => x.addr === keyPublicAddress && x.type === 'internal').length
        ).toEqual(1)

        unsubscribe()
        done()
      }
    })
  })

  test('should change keystore password', (done) => {
    keystore.changeKeystorePassword(pass, `${pass}1`)

    const unsubscribe = keystore.onUpdate(async () => {
      if (keystore.latestMethodCall === 'changeKeystorePassword' && keystore.status === 'DONE') {
        const secrets = await storage.get('keystoreSecrets', [])
        expect(secrets).toHaveLength(1)

        unsubscribe()
        done()
      }
    })
  })

  test('should get an internal signer', async () => {
    expect.assertions(2)
    const internalSigner: any = await keystore.getSigner(keyPublicAddress, 'internal')
    expect(internalSigner.privKey).toEqual(privKey)
    expect(internalSigner.key.addr).toEqual(keyPublicAddress)
  })

  test('should not get a signer', () => {
    expect(
      keystore.getSigner('0xc7E32B118989296eaEa88D86Bd9041Feca77Ed36', 'internal')
    ).rejects.toThrow('keystore: key not found')
  })

  test('should throw not unlocked', (done) => {
    const unsubscribe = keystore.onUpdate(async () => {
      expect(keystore.getSigner(keyPublicAddress, 'internal')).rejects.toThrow(
        'keystore: not unlocked'
      )

      unsubscribe()
      done()
    })

    keystore.lock()
  })

  test('should export key backup, create wallet and compare public address', (done) => {
    // changeKeystorePassword changed the password in the tests above so now unlock with the new password
    keystore.unlockWithSecret('password', `${pass}1`)

    const unsubscribe = keystore.onUpdate(async () => {
      if (keystore.latestMethodCall === 'unlockWithSecret' && keystore.status === 'DONE') {
        const keyBackup = await keystore.exportKeyWithPasscode(
          keyPublicAddress,
          'internal',
          'goshoPazara'
        )
        const wallet = await Wallet.fromEncryptedJson(JSON.parse(keyBackup), 'goshoPazara')
        expect(wallet.address).toBe(keyPublicAddress)

        unsubscribe()
        done()
      }
    })
  })

  test('should return uid', async () => {
    const keystoreUid = await keystore.getKeyStoreUid()
    expect(keystoreUid.length).toBe(32)
  })
})
