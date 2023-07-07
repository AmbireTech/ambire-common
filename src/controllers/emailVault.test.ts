import fetch from 'node-fetch'
import { EmailVaultController } from './emailVault'
import { Storage } from '../interfaces/storage'

export function produceMemoryStore(): Storage {
  const storage = new Map()
  return {
    get: (key, defaultValue): any => {
      const serialized = storage.get(key)
      return Promise.resolve(serialized ? JSON.parse(serialized) : defaultValue)
    },
    set: (key, value) => {
      storage.set(key, JSON.stringify(value))
      return Promise.resolve(null)
    }
  }
}

const storage = produceMemoryStore()
const email = 'emil@ambire.com'
const relayerUrl = 'https://staging-relayer.ambire.com'
const emailVaultController = new EmailVaultController(storage, fetch, relayerUrl)

emailVaultController.onUpdate(() => {
  console.log(emailVaultController.getCurrentState())
  //   console.log('isWaitingEmailConfirmation', emailVaultController.isWaitingEmailConfirmation)
  emailVaultController.emailVaultStates.length > 0 &&
    console.log(JSON.stringify(emailVaultController.emailVaultStates, null, 2))
})

emailVaultController.login(email)
