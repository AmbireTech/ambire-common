import { beforeAll, describe, expect, test } from '@jest/globals'
import fetch from 'node-fetch'
import { Wallet } from 'ethers'

import { relayerCall } from '../relayerCall/relayerCall'
import { EmailVault } from './emailVault'
import { requestMagicLink } from '../magicLink/magicLink'
import { Operation } from '../../interfaces/emailVault'

let email: String
let email2: String

// Relayer have to be start with NODE_ENV === 'testing' to can retrive the secret
const relayerUrl = 'http://localhost:1934'
const callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
const emailVault = new EmailVault(fetch, relayerUrl)
const errorPrefix = 'relayer call error:'
let authKey: String
let authSecret: String // this will not be return in prod mode
let recoveryKey: String
let authKey2: String
let authSecret2: String // this will not be return in prod mode
let recoveryKey2: String
const keyBackup: String = JSON.stringify({ a: 1 })
const keyStoreSecret = 'keyStoreSecretHere'

const initEmailVaultTest = async () => {
  email = `yosif+${Wallet.createRandom().address.slice(12, 20)}@ambire.com`.toLowerCase()
  email2 = `yosif+${Wallet.createRandom().address.slice(12, 20)}@ambire.com`.toLowerCase()
  const keys1 = await requestMagicLink(email, relayerUrl, fetch)
  authKey = keys1.key
  authSecret = keys1.secret!
  const keys2 = await requestMagicLink(email2, relayerUrl, fetch)
  authKey2 = keys2.key
  authSecret2 = keys2.secret!
  await callRelayer(`/email-vault/confirmationKey/${email}/${authKey}/${authSecret}`)
}

describe('happy cases email vault', () => {
  beforeAll(async () => {
    email = `yosif+${Wallet.createRandom().address.slice(12, 20)}@ambire.com`.toLowerCase()
    const result = await requestMagicLink(email, relayerUrl, fetch)
    authKey = result.key
    authSecret = result.secret!
    await callRelayer(`/email-vault/confirmationKey/${email}/${authKey}/${authSecret}`)
  })

  test('create an email vault', async () => {
    const res = await emailVault.create(email, authKey)
    expect(res.key).not.toBe('')
    expect(res.type).toBe('recoveryKey')
    expect(res).not.toHaveProperty('value')
  })

  test('get recoveryKey address', async () => {
    const res = await emailVault.getRecoveryKeyAddress(email, authKey)
    expect(res.key).not.toBe('')
    expect(res.type).toBe('recoveryKey')
    expect(res).not.toHaveProperty('value')
    recoveryKey = res.key
  })

  test('add keyStoreSecret', async () => {
    const success = await emailVault.addKeyStoreSecret(email, authKey, recoveryKey, keyStoreSecret)
    expect(success).toBeTruthy()
  })

  test('retrieve keyStoreSecret', async () => {
    const res = await emailVault.retrieveKeyStoreSecret(email, authKey, recoveryKey)
    expect(res.key).toBe(recoveryKey)
    expect(res.value).toBe(keyStoreSecret)
    expect(res.type).toBe('keyStore')
  })

  test('add keyBackup', async () => {
    const success = await emailVault.addKeyBackup(email, authKey, recoveryKey, keyBackup)
    expect(success).toBeTruthy()
  })

  test('getEmailVltInfo', async () => {
    const res = await emailVault.getInfo(email, authKey)
    expect(res).toHaveProperty('email', email)
    expect(res.availableSecrets.length).toBe(3)
    expect(res.availableSecrets[0].type).toBe('recoveryKey')
    expect(res.availableSecrets[1].type).toBe('keyStore')
    expect(res.availableSecrets[2].type).toBe('keyBackup')
    res.availableSecrets.forEach((s) => {
      expect(s).toHaveProperty('key')
    })
  })
  test('add operations', async () => {
    const operations = [
      {
        // id?: string
        requestType: 'sync data',
        requester: 'me',
        key: 'public key'
        // value?: string
      },
      {
        // id?: string
        requestType: 'sync data2',
        requester: 'you?',
        key: 'public key',
        value: 'value'
      },
      {
        id: 'sike, shoudnt have id',
        requestType: 'sync data2',
        requester: 'you?',
        key: 'public key',
        value: 'value'
      }
    ]
    const storedOperations = await emailVault.operations(email, authKey, operations)
    expect(storedOperations.length).toBe(2)
    storedOperations.forEach((op, i) => {
      expect(op).toHaveProperty('id')
      expect(op).toMatchObject(operations[i])
    })
    const newOperations = storedOperations.map((op) => ({ ...op, value: 'new value' }))
    const res = await emailVault.operations(email, authKey, newOperations)
    expect(res.length).toBe(2)
    res.forEach((op: Operation, i) => {
      expect(op).toHaveProperty('id')
      expect(op).toHaveProperty('value', 'new value')
      expect(op).toMatchObject(newOperations[i])
    })
  })
})
describe('err cases', () => {
  beforeEach(async () => {
    await initEmailVaultTest()
  })
  describe('create', () => {
    test('invalid email', async () => {
      await expect(emailVault.create('invalidEmail', authKey)).rejects.toThrow(
        `${errorPrefix} invalid email`
      )
    })
    test('no  key', async () => {
      await expect(emailVault.create(email, authKey2)).rejects.toThrow(`${errorPrefix} invalid key`)
    })
    test('not confirmed', async () => {
      await expect(emailVault.create(email2, authKey2)).rejects.toThrow(
        `${errorPrefix} invalid key`
      )
    })

    test('already created', async () => {
      await emailVault.create(email, authKey)
      await expect(emailVault.create(email, authKey)).rejects.toThrow(
        `${errorPrefix} email vault exists`
      )
    })
  })

  describe('getRecoveryKeyAddress', () => {
    test('invalid email', async () => {
      await expect(emailVault.getRecoveryKeyAddress('invalidEmail', authKey)).rejects.toThrow(
        `${errorPrefix} invalid email`
      )
    })
    test('invalid key', async () => {
      await expect(emailVault.getRecoveryKeyAddress(email, authKey2)).rejects.toThrow(
        `${errorPrefix} invalid key`
      )
    })
    test('not confirmed', async () => {
      await expect(emailVault.getRecoveryKeyAddress(email2, authKey2)).rejects.toThrow(
        `${errorPrefix} invalid key`
      )
    })
    test('vault not created', async () => {
      await expect(emailVault.getRecoveryKeyAddress(email, authKey)).rejects.toThrow(
        `${errorPrefix} email vault does not exist`
      )
    })
  })
  describe('addKeyStoreSecret', () => {
    beforeEach(async () => {
      await emailVault.create(email, authKey)
      const res = await emailVault.getRecoveryKeyAddress(email, authKey)
      recoveryKey = res.key
    })
    test('invalid email', async () => {
      await expect(
        emailVault.addKeyStoreSecret('invalidEmail', authKey, recoveryKey, keyStoreSecret)
      ).rejects.toThrow(`${errorPrefix} invalid email`)
    })
    test('invalid  authKey', async () => {
      await expect(
        emailVault.addKeyStoreSecret(email, authKey2, recoveryKey, keyStoreSecret)
      ).rejects.toThrow(`${errorPrefix} invalid key`)
    })
    test('not confirmed', async () => {
      await expect(
        emailVault.addKeyStoreSecret(email2, authKey2, '', keyStoreSecret)
      ).rejects.toThrow(`${errorPrefix} missing uid or not a valid address`)
    })
    test('vault not created', async () => {
      await callRelayer(`/email-vault/confirmationKey/${email2}/${authKey2}/${authSecret2}`)

      await expect(
        emailVault.addKeyStoreSecret(email2, authKey2, '', keyStoreSecret)
      ).rejects.toThrow(`${errorPrefix} missing uid or not a valid address`)
    })
    test('no secret in body', async () => {
      await callRelayer(`/email-vault/confirmationKey/${email2}/${authKey2}/${authSecret2}`)

      await emailVault.create(email2, authKey2)
      await expect(emailVault.addKeyStoreSecret(email2, authKey2, '', '')).rejects.toThrow(
        `${errorPrefix} secret is missing`
      )
    })
  })
  describe('retrieveKeyStoreSecret', () => {
    beforeEach(async () => {
      await emailVault.create(email, authKey)
      const res = await emailVault.getRecoveryKeyAddress(email, authKey)
      recoveryKey = res.key
      await emailVault.addKeyStoreSecret(email, authKey, recoveryKey, keyStoreSecret)
    })
    test('invalid email', async () => {
      await expect(
        emailVault.retrieveKeyStoreSecret('invalidEmail', authKey, recoveryKey)
      ).rejects.toThrow(`${errorPrefix} invalid email`)
    })
    test('invalid  authKey', async () => {
      await expect(emailVault.retrieveKeyStoreSecret(email, authKey2, recoveryKey)).rejects.toThrow(
        `${errorPrefix} invalid key`
      )
    })
    test('not confirmed', async () => {
      await expect(
        emailVault.retrieveKeyStoreSecret(email2, authKey2, recoveryKey)
      ).rejects.toThrow(`${errorPrefix} invalid key`)
    })
    test('vault not created', async () => {
      await callRelayer(`/email-vault/confirmationKey/${email2}/${authKey2}/${authSecret2}`)

      await expect(
        emailVault.retrieveKeyStoreSecret(email2, authKey2, recoveryKey)
      ).rejects.toThrow(`${errorPrefix} email vault does not exist`)
    })
    test('no secret uploaded', async () => {
      await callRelayer(`/email-vault/confirmationKey/${email2}/${authKey2}/${authSecret2}`)

      await emailVault.create(email2, authKey2)
      recoveryKey2 = (await emailVault.getRecoveryKeyAddress(email2, authKey2)).key
      // await emailVault.create(email2, authKey2)
      await expect(
        emailVault.retrieveKeyStoreSecret(email2, authKey2, recoveryKey2)
      ).rejects.toThrow(`${errorPrefix} Keystore for requested key not found.`)
    })
  })

  describe('addKeyBackup', () => {
    beforeEach(async () => {
      await emailVault.create(email, authKey)
      const res = await emailVault.getRecoveryKeyAddress(email, authKey)
      recoveryKey = res.key
    })
    test('invalid email', async () => {
      await expect(
        emailVault.addKeyBackup('invalidEmail', authKey, recoveryKey, keyBackup)
      ).rejects.toThrow(`${errorPrefix} invalid email`)
    })
    test('invalid  authKey', async () => {
      await expect(
        emailVault.addKeyBackup(email, authKey2, recoveryKey, keyBackup)
      ).rejects.toThrow(`${errorPrefix} invalid key`)
    })
    test('invalid  recoveryKey', async () => {
      await expect(emailVault.addKeyBackup(email, authKey, 'a', keyBackup)).rejects.toThrow(
        `${errorPrefix} missing uid or not a valid address`
      )
    })
    test('no backup in body', async () => {
      await callRelayer(`/email-vault/confirmationKey/${email2}/${authKey2}/${authSecret2}`)
      await emailVault.create(email2, authKey2)
      recoveryKey2 = (await emailVault.getRecoveryKeyAddress(email2, authKey2)).key
      await expect(emailVault.addKeyBackup(email2, authKey2, recoveryKey2, '')).rejects.toThrow(
        `${errorPrefix} missing encryptedBackup`
      )
    })
    test('no backup in body', async () => {
      await callRelayer(`/email-vault/confirmationKey/${email2}/${authKey2}/${authSecret2}`)
      await emailVault.create(email2, authKey2)
      recoveryKey2 = (await emailVault.getRecoveryKeyAddress(email2, authKey2)).key
      await expect(
        emailVault.addKeyBackup(email2, authKey2, recoveryKey2, 'invalidBackup')
      ).rejects.toThrow(`${errorPrefix} encryptedBackup is not valid`)
    })
  })

  describe('retrieveKeyBackup', () => {
    beforeEach(async () => {
      await emailVault.create(email, authKey)
      const res = await emailVault.getRecoveryKeyAddress(email, authKey)
      recoveryKey = res.key
      await emailVault.addKeyBackup(email, authKey, recoveryKey, keyBackup)
    })
    test('invalid email', async () => {
      await expect(
        emailVault.retrieveKeyBackup('invalidEmail', authKey, recoveryKey)
      ).rejects.toThrow(`${errorPrefix} invalid email`)
    })
    test('invalid  authKey', async () => {
      await expect(emailVault.retrieveKeyBackup(email, authKey2, recoveryKey)).rejects.toThrow(
        `${errorPrefix} invalid key`
      )
    })
    test('invalid  recoveryKey', async () => {
      await expect(emailVault.retrieveKeyBackup(email, authKey, 'a')).rejects.toThrow(
        `${errorPrefix} missing uid or not a valid address`
      )
    })
    test('not confirmed', async () => {
      await expect(emailVault.retrieveKeyBackup(email2, authKey2, recoveryKey)).rejects.toThrow(
        `${errorPrefix} invalid key`
      )
    })
    test('vault not created', async () => {
      await callRelayer(`/email-vault/confirmationKey/${email2}/${authKey2}/${authSecret2}`)
      await expect(emailVault.retrieveKeyBackup(email2, authKey2, recoveryKey)).rejects.toThrow(
        `${errorPrefix} email vault does not exist`
      )
    })
    test('no keyBakcup uploaded', async () => {
      await callRelayer(`/email-vault/confirmationKey/${email2}/${authKey2}/${authSecret2}`)
      await emailVault.create(email2, authKey2)
      recoveryKey2 = (await emailVault.getRecoveryKeyAddress(email2, authKey2)).key
      // await emailVault.create(email2, authKey2)
      await expect(emailVault.retrieveKeyBackup(email2, authKey2, recoveryKey2)).rejects.toThrow(
        `${errorPrefix} Backup for requested key not found.`
      )
    })
  })
})
