/* eslint-disable class-methods-use-this */
import fetch from 'node-fetch'
import { expect } from '@jest/globals'
import { requestMagicLink } from '../../libs/magicLink/magicLink'
import { EmailVaultController } from './emailVault'
import { Key, Keystore } from '../../libs/keystore/keystore'
import { Storage } from '../../interfaces/storage'
import { EmailVault } from '../../../dist/libs/emailVault/emailVault'

function produceMemoryStore(): Storage {
  const storage = new Map()
  return {
    get: (key: string, defaultValue: any): any => {
      const serialized = storage.get(key)
      return Promise.resolve(serialized ? JSON.parse(serialized) : defaultValue)
    },
    set: (key: string, value: any) => {
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

const keystoreSigners = { internal: InternalSigner }

const getRandomEmail = () => {
  return `yosif${Math.random().toString().slice(2)}@ambire.com`
}
let storage: Storage
const relayerUrl: string = 'http://localhost:1934'
let keystore: Keystore
let email: string
describe('happy cases', () => {
  beforeEach(() => {
    email = getRandomEmail()
    ;[storage, keystore] = [
      produceMemoryStore(),
      new Keystore(produceMemoryStore(), keystoreSigners)
    ]
  })
  test('login first time', async () => {
    const ev = new EmailVaultController(storage, fetch, relayerUrl, keystore)
    await ev.login(email)

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
    await fetch(`${relayerUrl}/email-vault/confirmationKey/${email}/${keys.key}/${keys.secret}`)
    await evLib.create(email, keys.key)
    // not logged in
    expect(ev.emailVaultStates.email[email]).toBeUndefined()
    await ev.login(email)
    // after successfuly logged in
    expect(ev.emailVaultStates.email[email]).toMatchObject({
      email,
      recoveryKey: expect.stringContaining('0x'),
      availableSecrets: expect.anything(),
      availableAccounts: {},
      operations: []
    })
    await ev.login(email)
    // after second login attempt
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
    await ev.login(email)
    expect(Object.keys(ev.emailVaultStates.email[email].availableSecrets).length).toBe(1)
    await ev.uploadKeyStoreSecret(email)
    const newSecrets = ev.emailVaultStates.email[email].availableSecrets
    expect(Object.keys(newSecrets).length).toBe(2)
    const key = Object.keys(newSecrets).find((k) => newSecrets[k]?.type === 'keyStore')
    expect(key).toBeTruthy()
    expect(newSecrets[key!]).toMatchObject({ key, type: 'keyStore' })
  })
  test('getKeyStoreSecret', async () => {
    const evLib = new EmailVault(fetch, relayerUrl)
    const ev = new EmailVaultController(storage, fetch, relayerUrl, keystore)
    const keys = await requestMagicLink(email, relayerUrl, fetch)
    const [keystoreUid, keystoreSecret] = ['uid', 'secret']

    await keystore.addSecret(keystoreUid, keystoreSecret)

    await fetch(`${relayerUrl}/email-vault/confirmationKey/${email}/${keys.key}/${keys.secret}`)
    await evLib.create(email, keys.key)

    await evLib.addKeyStoreSecret(email, keys.key, keystoreUid, keystoreSecret)

    await ev.login(email)
    const secretOne = ev.emailVaultStates.email[email].availableSecrets?.[keystoreUid]
    expect(secretOne).toHaveProperty('key', keystoreUid)
    expect(secretOne).toHaveProperty('type', 'keyStore')
    expect(secretOne).not.toHaveProperty('secret')
    await ev.getKeyStoreSecret(email)
    const keystoreSecrets = await keystore.getMainKeyEncryptedWithSecrets()
    expect(keystoreSecrets.length).toBe(1)
    expect(keystoreSecrets[0].id).toBe(keystoreUid)
  })
  test('request key sync', async () => {
    const [storage2, keystore2] = [
      produceMemoryStore(),
      new Keystore(produceMemoryStore(), keystoreSigners)
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
    await ev.login(email)
    // used to add keystore uid
    await keystore.addSecret('smth', 'secret')
    await keystore.unlockWithSecret('smth', 'secret')
    await keystore.addKeys([{ privateKey: keys[0].privateKey, label: keys[0].address }])
    await keystore.addKeys([{ privateKey: keys[1].privateKey, label: keys[1].address }])

    // ev 2
    const ev2 = new EmailVaultController(storage2, fetch, relayerUrl, keystore2)
    await ev2.login(email)
    await keystore2.addSecret('smth2', 'secret2')
    await keystore2.unlockWithSecret('smth2', 'secret2')
    ev2.onUpdate(async () => {
      if (ev2.emailVaultStates.email[email].operations[0].id) {
        await ev.fulfillSyncRequests(email)
      }
    })
    await ev2.requestKeysSync(
      email,
      keys.map((k) => k.address)
    )
    expect(JSON.parse(ev2.emailVaultStates.email[email].operations[0].value || '{}')).toMatchObject(
      {
        label: keys[0].address,
        privateKey: {
          iv: expect.anything(),
          ephemPublicKey: expect.anything(),
          ciphertext: expect.anything(),
          mac: expect.anything()
        }
      }
    )
    expect(JSON.parse(ev2.emailVaultStates.email[email].operations[1].value || '{}')).toMatchObject(
      {
        label: keys[1].address,
        privateKey: {
          iv: expect.anything(),
          ephemPublicKey: expect.anything(),
          ciphertext: expect.anything(),
          mac: expect.anything()
        }
      }
    )
    expect(await keystore2.getSigner(keys[0].address, 'internal')).toMatchObject({
      key: {
        addr: keys[0].address,
        label: keys[0].address,
        type: 'internal',
        meta: null,
        isExternallyStored: false
      },
      privKey: keys[0].privateKey
    })
    expect(await keystore2.getSigner(keys[1].address, 'internal')).toMatchObject({
      key: {
        addr: keys[1].address,
        label: keys[1].address,
        type: 'internal',
        meta: null,
        isExternallyStored: false
      },
      privKey: keys[1].privateKey
    })
  })
})
