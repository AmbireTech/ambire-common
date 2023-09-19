import fetch from 'node-fetch'
import { produceMemoryStore } from '../main/main.test'
import { EmailVaultController } from '../../../dist/controllers/emailVault'
import { Keystore } from '../../../dist/libs/keystore/keystore'

describe('happy cases', () => {
  test('asd', async () => {
    const [storage, relayerUrl, keystore] = [
      produceMemoryStore(),
      'http://localhost:1932',
      new Keystore(produceMemoryStore(), {})
    ]
    const ev = new EmailVaultController(storage, fetch, relayerUrl, keystore)
    await ev.load()
    // console.log(ev)
  })
})
