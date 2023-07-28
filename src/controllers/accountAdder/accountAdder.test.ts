import { JsonRpcProvider } from 'ethers'
import { Account } from 'interfaces/account'
import fetch from 'node-fetch'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
import { KeyIterator } from '../../libs/keyIterator/keyIterator'
import { AccountAdderController } from './accountAdder'

const providers = Object.fromEntries(
  networks.map((network) => [network.id, new JsonRpcProvider(network.rpcUrl)])
)
// Helpers/testing
function produceMemoryStore(): Storage {
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

const relayerUrl = 'https://relayer.ambire.com'

const accountAdder = new AccountAdderController({
  storage: produceMemoryStore(),
  relayerUrl,
  fetch
})

const seedPhrase =
  'brisk rich glide impose category stuff company you appear remain decorate monkey'
// const privKey = '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
const keyPublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'

const legacyAccount: Account = {
  addr: keyPublicAddress,
  label: '',
  pfp: '',
  associatedKeys: [keyPublicAddress],
  creation: null
}

describe('AccountAdder', () => {
  test('should initialize accountAdder', () => {
    expect.assertions(4)
    expect((accountAdder as any)['#keyIterator']).toBe(undefined)
    expect((accountAdder as any).derivationPath).toBe(undefined)
    expect((accountAdder as any).page).toEqual(1)
    expect((accountAdder as any).isInitialized).toBeFalsy()
  })
  test('should throw not initialized', async () => {
    expect.assertions(1)
    try {
      await accountAdder.setPage({ page: 1, networks, providers })
    } catch (e: any) {
      expect(e.message).toBe('accountAdder: keyIterator not initialized')
    }
  })
  test('should init keyIterator', () => {
    expect.assertions(2)
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({ keyIterator, preselectedAccounts: [] })
    expect((accountAdder as any)['#keyIterator']).toBe(undefined)
    expect((accountAdder as any).isInitialized).toBeTruthy()
  })
  test('should get first page', async () => {
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({ keyIterator, preselectedAccounts: [], pageSize: 1 })
    accountAdder.setPage({ page: 1, networks, providers })
    let counter = 0
    await new Promise((resolve) => {
      accountAdder.onUpdate(() => {
        if (counter < 2) {
          // No linked accounts yet. Only legacy and smart
          expect(accountAdder.accountsOnPage.length).toEqual(2)
        } else {
          // On the third emit there have to be linked accounts fetched
          expect(accountAdder.accountsOnPage.length).toEqual(3)
          resolve(null)
        }
        counter++
      })
    })
  })
  test('should not be able to deselect a preselected account', async () => {
    try {
      const keyIterator = new KeyIterator(seedPhrase)
      accountAdder.init({ keyIterator, preselectedAccounts: [legacyAccount], pageSize: 1 })
      accountAdder.selectedAccounts = [legacyAccount]
      await accountAdder.deselectAccount(legacyAccount)
    } catch (e: any) {
      expect(e.message).toBe('accountAdder: a preselected account cannot be deselected')
    }
  })
})
