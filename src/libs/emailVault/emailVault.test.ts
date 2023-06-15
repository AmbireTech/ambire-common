/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
/* eslint-disable max-classes-per-file */
import { beforeAll, describe, expect, test } from '@jest/globals'
import fetch from 'node-fetch'
import { Wallet } from 'ethers'

import { EmailVault } from './emailVault'
import { requestMagicLink } from '../magicLink/magicLink'

let email: String
let email2: String

// Relayer have to be start with NODE_ENV === 'testing' to can retrive the secret
const relayerUrl = 'http://localhost:1934'

const emailVault = new EmailVault(fetch, relayerUrl)
let authKey: String
let authSecret: String // this will not be return in prod mode
let recoveryKey: String
const keyBackup: String = JSON.stringify({ a: 1 })
const keyStoreSecret = 'keyStoreSecretHere'

const initEmailVaultTest = async () => {
  email = `yosif+${Wallet.createRandom().address.slice(12, 20)}@ambire.com`
  email2 = `yosif+${Wallet.createRandom().address.slice(12, 20)}@ambire.com`
  const keys1 = await requestMagicLink(email, relayerUrl, fetch)
  authKey = keys1.key
  authSecret = keys1.secret
  const keys2 = await requestMagicLink(email2, relayerUrl, fetch)
  authKey = keys2.key
  authSecret = keys2.secret

  await fetch(`${relayerUrl}/email-vault/confirmationKey/${email}/${authKey}/${authSecret}`)
}

describe('Email vault', () => {
  describe('positive tests', () => {
    beforeAll(async () => {
      email = `yosif+${Wallet.createRandom().address.slice(12, 20)}@ambire.com`
      const result = await requestMagicLink(email, relayerUrl, fetch)
      authKey = result.key
      authSecret = result.secret
      await fetch(`${relayerUrl}/email-vault/confirmationKey/${email}/${authKey}/${authSecret}`)
    })

    test('create an email vault', async () => {
      const { key, type, value } = await emailVault.create(email, authKey)
      expect(key).not.toBe('')
      expect(type).toBe('recoveryKey')
      expect(value).toBeFalsy()
    })

    test('get recoveryKey address', async () => {
      const { key, type, value } = await emailVault.getRecoveryKeyAddress(email, authKey)
      expect(key).not.toBe('')
      expect(type).toBe('recoveryKey')
      expect(value).toBeFalsy()
      recoveryKey = key
    })

    test('add keyStoreSecret', async () => {
      const success = await emailVault.addKeyStoreSecret(
        email,
        authKey,
        recoveryKey,
        keyStoreSecret
      )
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
  })

  describe('negative tests', () => {
    describe('create', () => {
      beforeEach(initEmailVaultTest)
      test('no email', async () => {})
      test('invalid email', async () => {})
      test('no  key', async () => {})
      test('not confirmed', async () => {})
    })

    describe('getRecoveryKeyAddress', () => {
      beforeEach(initEmailVaultTest)
      test('no email', async () => {})
      test('invalid email', async () => {})
      test('no  key', async () => {})
      test('not confirmed', async () => {})
      test('vault not created', async () => {})
    })
    describe('addKeyStoreSecret', () => {
      beforeEach(initEmailVaultTest)
      test('no email', async () => {})
      test('invalid email', async () => {})
      test('no  key', async () => {})
      test('not confirmed', async () => {})
      test('no uid', async () => {})
      test('vault not created', async () => {})
      test('no secret in body', async () => {})
    })
    describe('retrieveKeyStoreSecret', () => {
      beforeEach(initEmailVaultTest)
      test('no email', async () => {})
      test('invalid email', async () => {})
      test('no  key', async () => {})
      test('not confirmed', async () => {})
      test('vault not created', async () => {})
      test('no secret uploaded', async () => {})
    })

    describe('addKeyBackup', () => {
      beforeEach(initEmailVaultTest)
      test('no email', async () => {})
      test('invalid email', async () => {})
      test('no  key', async () => {})
      test('not confirmed', async () => {})
      test('vault not created', async () => {})
      test('no keyBackup in body', async () => {})
    })

    describe('retrieveKeyBackup', () => {
      beforeEach(initEmailVaultTest)
      test('no email', async () => {})
      test('invalid email', async () => {})
      test('no  key', async () => {})
      test('not confirmed', async () => {})
      test('vault not created', async () => {})
      test('no backup uploaded', async () => {})
    })
  })
})
