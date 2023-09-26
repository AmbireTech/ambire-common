/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
/* eslint-disable max-classes-per-file */

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
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(_key: Key) {}

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
  test('should initialize', () => {
    keystore = new KeystoreController(produceMemoryStore(), keystoreSigners)

    expect(keystore).toBeDefined()
  })
  test('should add a secret', async () => {
    expect.assertions(2)
    await keystore.addSecret('passphrase', pass, '', false)

    expect(keystore.isUnlocked()).toBe(false)
    expect(await keystore.isReadyToStoreKeys()).toBe(true)
  })
  test('should not unlock with non-existant secret', async () => {
    expect.assertions(1)
    await keystore.unlockWithSecret('playstation', '')

    expect(keystore.isUnlocked()).toBe(false)
  })
  test('should unlock with secret', async () => {
    await keystore.unlockWithSecret('passphrase', pass)

    expect(keystore.isUnlocked()).toBe(true)
  })
})
