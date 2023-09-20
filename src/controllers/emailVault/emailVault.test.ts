import fetch from 'node-fetch'
import { expect } from '@jest/globals'
import { requestMagicLink } from '../../libs/magicLink/magicLink'
import { EmailVaultController } from './emailVault'
import { Keystore } from '../../libs/keystore/keystore'
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
    ;[storage, keystore] = [produceMemoryStore(), new Keystore(produceMemoryStore(), {})]
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
    const email: string = getRandomEmail()

    const [storage, relayerUrl, keystore] = [
      produceMemoryStore(),
      'http://localhost:1934',
      new Keystore(produceMemoryStore(), {})
    ]
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
})
