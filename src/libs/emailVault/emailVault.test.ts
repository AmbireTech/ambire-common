/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
/* eslint-disable max-classes-per-file */
import { describe, expect, test } from '@jest/globals'
import fetch from 'node-fetch'
import { Wallet } from 'ethers'

import { EmailVault } from './emailVault'
import { requestMagicLink } from '../magicLink/magicLink'

const email = `emil+${Wallet.createRandom().address.slice(12, 20)}@ambire.com`

// Relayer have to be start with NODE_ENV === 'testing' to can retrive the secret
const relayerUrl = 'http://localhost:1934'

const emailVault = new EmailVault(fetch, relayerUrl)
let authKey: String
let authSecret: String // this will not be return in prod mode

describe('MagicLink', () => {
  test('should return a key for session and relayer should be run in test mode', async () => {
    const result = await requestMagicLink(email, relayerUrl, fetch)
    authKey = result.key
    authSecret = result.secret
    expect((authKey as string) && authKey !== '' && (authSecret as string) && authSecret !== '')
  })

  test('confirm magic link', async () => {
    const resp = await fetch(
      `${relayerUrl}/email-vault/confirmationKey/${email}/${authKey}/${authSecret}`
    )
    const { success, message } = await resp.json()
    expect(success && message === 'email is confirmed')
  })

  test('create an email vault', async () => {
    const { key, type, value } = await emailVault.create(email, authKey)
    expect((key as string) && key !== '' && type === 'recoveryKey' && value === undefined)
  })
})
