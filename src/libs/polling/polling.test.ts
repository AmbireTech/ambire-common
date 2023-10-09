import fetch from 'node-fetch'

import { expect } from '@jest/globals'
import { Polling } from './polling'
import { requestMagicLink } from '../magicLink/magicLink'
import { EmailVault } from '../emailVault/emailVault'
import { EmailVaultData } from '../../interfaces/emailVault'
import { relayerCall } from '../relayerCall/relayerCall'

const getRandomEmail = () => {
  return `yosif+${Math.random().toString().slice(2)}@ambire.com`
}
const email = getRandomEmail()
const relayerUrl = 'https://staging-relayer.ambire.com'
// const relayerUrl = 'http://localhost:1934'

describe('Polling', () => {
  const ev: EmailVault = new EmailVault(fetch, relayerUrl)
  beforeEach(async () => {
    const callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    const keys = await requestMagicLink(email, relayerUrl, fetch)
    await callRelayer(`/email-vault/confirmationKey/${email}/${keys.key}/${keys.secret}`)
    await ev.getEmailVaultInfo(email, keys.key)
  })
  test('test', async () => {
    const polling = new Polling()
    const magicLinkKey = await requestMagicLink(email, relayerUrl, fetch)

    polling.onUpdate(() => {
      if (polling.state.isError) {
        console.log('[onUpdate] last status:', polling.state.error.output.res.status)
      }
    })
    const result: EmailVaultData | null = await polling.exec(ev.getEmailVaultInfo.bind(ev), [
      email,
      magicLinkKey.key
    ])
    expect(result).toMatchObject({
      isError: false,
      email,
      recoveryKey: expect.stringContaining('0x'),
      availableSecrets: expect.anything(),
      availableAccounts: {},
      operations: []
    })
    // console.log({ result })
  })
})
