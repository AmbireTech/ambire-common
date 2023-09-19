import fetch from 'node-fetch'
import { expect, jest } from '@jest/globals'
import { EmailVaultController } from './emailVault'
import { Keystore } from '../../libs/keystore/keystore'
import { Storage } from '../../interfaces/storage'

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

describe('happy cases', () => {
  const email: string = `yosif+${new Date().getTime()}@ambire.com`
  // beforeAll(() => {})
  test('create vault', async () => {
    let updateCounter = 0
    const [storage, relayerUrl, keystore] = [
      produceMemoryStore(),
      'http://localhost:1934',
      new Keystore(produceMemoryStore(), {})
    ]
    const ev = new EmailVaultController(storage, fetch, relayerUrl, keystore)
    const onUpdate = jest.fn(() => {
      if (!updateCounter) expect(ev.emailVaultStates.email[email]).toBeFalsy()
      else
        expect(ev.emailVaultStates.email[email]).toMatchObject({
          email,
          recoveryKey: expect.stringContaining('0x'),
          availableSecrets: expect.anything(),
          availableAccounts: {},
          operations: []
        })
      // console.log('controller emited update')
      updateCounter++
    })
    // console.log(ev.getCurrentState())
    ev.onUpdate(onUpdate)
    await ev.createVault(email)
    // initialLoadPromise, getEmailVaultInfo and createVault
    expect(onUpdate).toBeCalledTimes(3)
  })
})
