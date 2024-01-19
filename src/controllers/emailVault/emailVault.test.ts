/* eslint-disable class-methods-use-this */
import fetch from 'node-fetch'
import { expect } from '@jest/globals'
import { KeystoreController } from '../keystore/keystore'
import { requestMagicLink } from '../../libs/magicLink/magicLink'
import { EmailVaultController } from './emailVault'
import { Storage } from '../../interfaces/storage'
import { EmailVault } from '../../libs/emailVault/emailVault'
import { Key } from '../../interfaces/keystore'
import { produceMemoryStore } from '../../../test/helpers'

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

const keystoreSigners = { internal: InternalSigner }

const getRandomEmail = () => {
  return `unufri+${Math.random().toString().slice(2)}@ambire.com`
}
let storage: Storage
const relayerUrl: string = 'https://staging-relayer.ambire.com'
// const relayerUrl: string = 'http://localhost:1934'
let keystore: KeystoreController
let email: string
describe('happy cases', () => {
  beforeEach(() => {
    email = getRandomEmail()
    ;[storage, keystore] = [
      produceMemoryStore(),
      new KeystoreController(produceMemoryStore(), keystoreSigners)
    ]
  })
  test('login first time', async () => {
    const ev = new EmailVaultController(storage, fetch, relayerUrl, keystore)
    await ev.getEmailVaultInfo(email)

    expect(ev.emailVaultStates.email[email]).toMatchObject({
      email,
      recoveryKey: expect.stringContaining('0x'),
      availableSecrets: expect.anything(),
      availableAccounts: {},
      operations: []
    })
  })
  test('login into existing', async () => {
    const evLib = new EmailVault(fetch, relayerUrl)
    const ev = new EmailVaultController(storage, fetch, relayerUrl, keystore)
    const keys = await requestMagicLink(email, relayerUrl, fetch)
    await fetch(`${relayerUrl}/email-vault/confirm-key/${email}/${keys.key}/${keys.secret}`)
    // createing
    await evLib.getEmailVaultInfo(email, keys.key)
    // not logged in
    expect(ev.emailVaultStates.email[email]).toBeUndefined()
    await ev.getEmailVaultInfo(email)
    // after successfuly logged in
    expect(ev.emailVaultStates.email[email]).toMatchObject({
      email,
      recoveryKey: expect.stringContaining('0x'),
      availableSecrets: expect.anything(),
      availableAccounts: {},
      operations: []
    })
  })
  test('upload keystore secret', async () => {
    const ev = new EmailVaultController(storage, fetch, relayerUrl, keystore)
    await ev.getEmailVaultInfo(email)
    expect(Object.keys(ev.emailVaultStates.email[email].availableSecrets).length).toBe(1)
    await ev.uploadKeyStoreSecret(email)
    const newSecrets = ev.emailVaultStates.email[email].availableSecrets
    expect(Object.keys(newSecrets).length).toBe(2)
    const key = Object.keys(newSecrets).find((k) => newSecrets[k]?.type === 'keyStore')
    expect(key).toBeTruthy()
    expect(newSecrets[key!]).toMatchObject({ key, type: 'keyStore' })
  })
  test('recoverKeyStore', async () => {
    const ev = new EmailVaultController(storage, fetch, relayerUrl, keystore)

    await ev.getEmailVaultInfo(email)
    expect(Object.keys(ev.emailVaultStates.email[email].availableSecrets).length).toBe(1)
    await ev.uploadKeyStoreSecret(email)
    expect(Object.keys(ev.emailVaultStates.email[email].availableSecrets).length).toBe(2)

    expect(keystore.isUnlocked).toBeFalsy()
    await ev.recoverKeyStore(email)
    expect(keystore.isUnlocked).toBeTruthy()
  })

  // @NOTE this test is supposed to fail because we have a new route for pulling the fulfilled operations
  // once the staging-relayer is updated we can continue with this.
  // (updating the staging would break the old version of the controller, we have to migrate both common and relayer at the same time)
  test('full keystore sync', async () => {
    const [storage2, keystore2] = [
      produceMemoryStore(),
      new KeystoreController(produceMemoryStore(), keystoreSigners)
    ]
    const keys = [
      {
        address: '0xDba1BA86e823FB82ee6181af6c32811000Ea7139',
        privateKey: '37f5be94ab09ab022f088f02049e3accfe5e451b9a16f0f51da9586244cd5e76'
      },
      {
        address: '0x4076170D9fc785a31452cC5b544B43b3bf5f97E2',
        privateKey: '75331017632eba0405f640655109a5233ac11714577ce95badab22fb63ce6d83'
      }
    ]
    // ev 1
    const ev = new EmailVaultController(storage, fetch, relayerUrl, keystore)
    await ev.getEmailVaultInfo(email)
    // used to add keystore uid
    await keystore.addSecret('smth', 'secret', '', false)
    await keystore.unlockWithSecret('smth', 'secret')
    await keystore.addKeys([{ privateKey: keys[0].privateKey, dedicatedToOneSA: false }])
    await keystore.addKeys([{ privateKey: keys[1].privateKey, dedicatedToOneSA: false }])

    // ev 2
    const ev2 = new EmailVaultController(storage2, fetch, relayerUrl, keystore2)
    await ev2.getEmailVaultInfo(email)
    await keystore2.addSecret('smth2', 'secret2', '', false)
    await keystore2.unlockWithSecret('smth2', 'secret2')

    // make two sync requests
    await ev2.requestKeysSync(
      email,
      keys.map((k) => k.address)
    )
    expect(ev2.emailVaultStates.email[email].operations.length).toBe(2)

    await ev.fulfillSyncRequests(email)
    expect(ev.emailVaultStates.email[email].operations.length).toBe(2)
    await ev2.finalizeSyncKeys(
      email,
      keys.map((k) => k.address)
    )
    expect(await keystore2.getKeys().then((d) => d.length)).toBe(2)
  })
})
