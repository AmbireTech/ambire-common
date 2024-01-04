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
const relayerUrl = 'https://staging-relayer.ambire.com'
const callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
const emailVault = new EmailVault(fetch, relayerUrl)
let authKey: String
let authSecret: String // this will not be return in prod mode
let recoveryKey: String
let authKey2: String
let authSecret2: String // this will not be return in prod mode
let recoveryKey2: String
const keyStoreSecret = 'keyStoreSecretHere'

const initEmailVaultTest = async () => {
  email = `unufri+${Wallet.createRandom().address.slice(12, 20)}@ambire.com`.toLowerCase()
  email2 = `unufri+${Wallet.createRandom().address.slice(12, 20)}@ambire.com`.toLowerCase()
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
    email = `unufri+${Wallet.createRandom().address.slice(12, 20)}@ambire.com`.toLowerCase()
    const result = await requestMagicLink(email, relayerUrl, fetch)
    authKey = result.key
    authSecret = result.secret!
    await callRelayer(`/email-vault/confirmationKey/${email}/${authKey}/${authSecret}`)
  })

  test('create an email vault', async () => {
    const res = await emailVault.getEmailVaultInfo(email, authKey)
    expect(res).toBeTruthy()
    const resRecKey = res!.availableSecrets[Object.keys(res!.availableSecrets)[0]]
    expect(resRecKey).toBeTruthy()
    expect(resRecKey.key).toBeTruthy()
    expect(resRecKey.type).toBe('recoveryKey')
    expect(resRecKey).not.toHaveProperty('value')
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

  test('getEmailVltInfo', async () => {
    const res = await emailVault.getInfo(email, authKey)
    expect(res).toHaveProperty('email', email)
    expect(res.availableSecrets.length).toBe(2)
    expect(res.availableSecrets[0].type).toBe('recoveryKey')
    expect(res.availableSecrets[1].type).toBe('keyStore')
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
    expect(storedOperations).toBeTruthy()
    expect(storedOperations?.length).toBe(2)
    storedOperations?.forEach((op, i) => {
      expect(op).toHaveProperty('id')
      expect(op).toMatchObject(operations[i])
    })
    const newOperations = storedOperations?.map((op) => ({ ...op, value: 'new value' }))!
    const res = await emailVault.operations(email, authKey, newOperations)
    expect(res).toBeTruthy()
    expect(res!.length).toBe(2)
    res!.forEach((op: Operation, i) => {
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
    test('no  key', async () => {
      await expect(emailVault.getEmailVaultInfo(email, authKey2)).rejects.toHaveProperty(
        ['output', 'res', 'message'],
        'invalid key'
      )
    })
    test('not confirmed', async () => {
      await expect(emailVault.getEmailVaultInfo(email2, authKey2)).rejects.toHaveProperty(
        ['output', 'res', 'message'],
        'invalid key'
      )
    })
  })

  describe('getRecoveryKeyAddress', () => {
    test('invalid email', async () => {
      await expect(
        emailVault.getRecoveryKeyAddress('invalidEmail', authKey)
      ).rejects.toHaveProperty(['output', 'res', 'message'], 'invalid email')
    })
    test('invalid key', async () => {
      await expect(emailVault.getRecoveryKeyAddress(email, authKey2)).rejects.toHaveProperty(
        ['output', 'res', 'message'],
        'invalid key'
      )
    })
    test('not confirmed', async () => {
      await expect(emailVault.getRecoveryKeyAddress(email2, authKey2)).rejects.toHaveProperty(
        ['output', 'res', 'message'],
        'invalid key'
      )
    })
    test('vault not created', async () => {
      await expect(emailVault.getRecoveryKeyAddress(email, authKey)).rejects.toHaveProperty(
        ['output', 'res', 'message'],
        'email vault does not exist'
      )
    })
  })
  describe('addKeyStoreSecret', () => {
    beforeEach(async () => {
      await emailVault.getEmailVaultInfo(email, authKey)
      const res = await emailVault.getRecoveryKeyAddress(email, authKey)
      recoveryKey = res.key
    })
    test('invalid email', async () => {
      await expect(
        emailVault.addKeyStoreSecret('invalidEmail', authKey, recoveryKey, keyStoreSecret)
      ).rejects.toHaveProperty(['output', 'res', 'message'], 'invalid email')
    })
    test('invalid  authKey', async () => {
      await expect(
        emailVault.addKeyStoreSecret(email, authKey2, recoveryKey, keyStoreSecret)
      ).rejects.toHaveProperty(['output', 'res', 'message'], 'invalid key')
    })
    test('not confirmed', async () => {
      await expect(
        emailVault.addKeyStoreSecret(email2, authKey2, '', keyStoreSecret)
      ).rejects.toHaveProperty(['output', 'res', 'message'], 'missing uid or not a valid address')
    })
    test('vault not created', async () => {
      await callRelayer(`/email-vault/confirmationKey/${email2}/${authKey2}/${authSecret2}`)

      await expect(
        emailVault.addKeyStoreSecret(email2, authKey2, '', keyStoreSecret)
      ).rejects.toHaveProperty(['output', 'res', 'message'], 'missing uid or not a valid address')
    })
    test('no secret in body', async () => {
      await callRelayer(`/email-vault/confirmationKey/${email2}/${authKey2}/${authSecret2}`)

      await emailVault.getEmailVaultInfo(email2, authKey2)
      await expect(emailVault.addKeyStoreSecret(email2, authKey2, '', '')).rejects.toHaveProperty(
        ['output', 'res', 'message'],
        'secret is missing'
      )
    })
  })
  describe('retrieveKeyStoreSecret', () => {
    beforeEach(async () => {
      await emailVault.getEmailVaultInfo(email, authKey)
      const res = await emailVault.getRecoveryKeyAddress(email, authKey)
      recoveryKey = res.key
      await emailVault.addKeyStoreSecret(email, authKey, recoveryKey, keyStoreSecret)
    })
    test('invalid email', async () => {
      await expect(
        emailVault.retrieveKeyStoreSecret('invalidEmail', authKey, recoveryKey)
      ).rejects.toHaveProperty(['output', 'res', 'message'], 'invalid email')
    })
    test('invalid  authKey', async () => {
      await expect(
        emailVault.retrieveKeyStoreSecret(email, authKey2, recoveryKey)
      ).rejects.toHaveProperty(['output', 'res', 'message'], 'invalid key')
    })
    test('not confirmed', async () => {
      await expect(
        emailVault.retrieveKeyStoreSecret(email2, authKey2, recoveryKey)
      ).rejects.toHaveProperty(['output', 'res', 'message'], 'invalid key')
    })
    test('vault not created', async () => {
      await callRelayer(`/email-vault/confirmationKey/${email2}/${authKey2}/${authSecret2}`)

      await expect(
        emailVault.retrieveKeyStoreSecret(email2, authKey2, recoveryKey)
      ).rejects.toHaveProperty(['output', 'res', 'message'], 'email vault does not exist')
    })
    test('no secret uploaded', async () => {
      await callRelayer(`/email-vault/confirmationKey/${email2}/${authKey2}/${authSecret2}`)

      await emailVault.getEmailVaultInfo(email2, authKey2)
      recoveryKey2 = (await emailVault.getRecoveryKeyAddress(email2, authKey2)).key
      // await emailVault.create(email2, authKey2)

      await expect(
        emailVault.retrieveKeyStoreSecret(email2, authKey2, recoveryKey2)
      ).rejects.toHaveProperty(
        ['output', 'res', 'message'],
        'Keystore for requested key not found.'
      )
    })
  })
})
