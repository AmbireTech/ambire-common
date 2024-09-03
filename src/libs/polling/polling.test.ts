import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { relayerUrl } from '../../../test/config'
import { EmailVaultData } from '../../interfaces/emailVault'
import { EmailVault } from '../emailVault/emailVault'
import { requestMagicLink } from '../magicLink/magicLink'
import { relayerCall } from '../relayerCall/relayerCall'
import { Polling } from './polling'

const getRandomEmail = () => {
  return `yosif+${Math.random().toString().slice(2)}@ambire.com`
}
const email = getRandomEmail()

describe('Polling', () => {
  const ev: EmailVault = new EmailVault(fetch, relayerUrl)
  beforeEach(async () => {
    const callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    const keys = await requestMagicLink(email, relayerUrl, fetch)
    try {
      await callRelayer(`/email-vault/confirm-key/${email}/${keys.key}/${keys.secret}`)
    } catch (e) {
      /* silence is bitcoin */
    }
    await ev.getEmailVaultInfo(email, keys.key)
  })
  test('Email vault polling', async () => {
    const polling = new Polling()
    const magicLinkKey = await requestMagicLink(email, relayerUrl, fetch, { autoConfirm: true })

    polling.onUpdate(() => {
      if (polling.state.isError) {
        // console.log('[onUpdate] last status:', polling.state.error.output.res.status)
      }
    })
    const result: EmailVaultData | null = await polling.exec(
      ev.getEmailVaultInfo.bind(ev),
      [email, magicLinkKey.key],
      null,
      null
    )
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

  describe('cleanup', () => {
    test('cleanup test happy case', (done) => {
      const polling = new Polling()
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      polling.exec(
        async () => {},
        [],
        () => done(),
        null,
        15000,
        1000
      )
    })
    test('cleanup timout', (done) => {
      const polling = new Polling()
      let i = 0
      const increment = async () => {
        i += 1
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw { output: { res: { status: 401 } } }
      }

      const doneIfReady = () => {
        // assuming there will be latency and will be called at least 5 times for 15 seconds
        if (i > 5) done()
        else expect(0).toBe(1)
      }

      polling.exec(increment, [], doneIfReady, null, 15000, 1000)
    })
    test('cleanup major fail', (done) => {
      const polling = new Polling()
      let i = 0
      const increment = async () => {
        i += 1
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw { output: { res: { status: 404 } } }
      }

      const doneIfReady = () => {
        // should enter the failing function only once
        if (i === 1) done()
        else expect(0).toBe(1)
      }

      polling.exec(increment, [], doneIfReady, null, 15000, 1000)
    })
  })
  describe('cancel', () => {
    test('cancel after 3 tries', (done) => {
      const polling = new Polling()
      let i = 0
      const increment = async () => {
        i += 1
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw { output: { res: { status: 401 } } }
      }
      const isReady = () => {
        expect(i).toBe(3)
        done()
      }
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      polling.exec(
        increment,
        [],
        () => isReady(),
        () => {
          return i === 3
        },
        15000,
        1000
      )
    })

    test('cancel after 3 tries', (done) => {
      const polling = new Polling()
      let i = 0
      let shouldStop = false
      const increment = async () => {
        i += 1
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw { output: { res: { status: 401 } } }
      }
      const isReady = () => {
        // we expect at least 4 calls for the 10 seconds (polling can be slow)
        expect(i).toBeGreaterThan(4)
        done()
      }

      setTimeout(() => {
        shouldStop = true
      }, 10000)

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      polling.exec(
        increment,
        [],
        () => isReady(),
        () => shouldStop,
        15000,
        1000
      )
    })
  })
})
