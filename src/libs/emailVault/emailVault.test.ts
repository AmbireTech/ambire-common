/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
/* eslint-disable max-classes-per-file */
import { describe, expect, test } from '@jest/globals'
import fetch from 'node-fetch'
import { Wallet } from 'ethers'

import { EmailVault } from './emailVault'
import { requestMagicLink } from '../magicLink/magicLink'

const email = `yosif+${Wallet.createRandom().address.slice(12, 20)}@ambire.com`

// Relayer have to be start with NODE_ENV === 'testing' to can retrive the secret
const relayerUrl = 'http://localhost:1934'

const emailVault = new EmailVault(fetch, relayerUrl)
let authKey: String
let authSecret: String // this will not be return in prod mode
let recoveryKey: String
let keyBackup:String  = JSON.stringify( {a:1} )
const keyStoreSecret = "keyStoreSecretHere"
describe('MagicLink', () => {
  test('should return a key for session and relayer should be run in test mode', async () => {
    const result = await requestMagicLink(email, relayerUrl, fetch)
    authKey = result.key
    authSecret = result.secret
    expect(authKey).not.toBe('')
    expect(authSecret).not.toBe('')
  })

  test('confirm magic link', async () => {
    const resp = await fetch(
      `${relayerUrl}/email-vault/confirmationKey/${email}/${authKey}/${authSecret}`
    )
    const { success, message } = await resp.json()
    expect(success).toBeTruthy()
    expect(message).toBe('email is confirmed')
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
})
