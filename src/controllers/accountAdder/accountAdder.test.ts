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

const seedPhrase =
  'brisk rich glide impose category stuff company you appear remain decorate monkey'
// const privKey = '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
const key1PublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'
// const key2PublicAddress = '0xE4166d78C834367B186Ce6492993ac8D52De738F'
// const key3PublicAddress = '0xcC48f0C6d79b6E79F90a3228E284324b5F2cC529'

const legacyAccount: Account = {
  addr: key1PublicAddress,
  label: '',
  pfp: '',
  associatedKeys: [key1PublicAddress],
  creation: null
}

describe('AccountAdder', () => {
  let accountAdder: AccountAdderController
  beforeEach(() => {
    accountAdder = new AccountAdderController({
      storage: produceMemoryStore(),
      relayerUrl,
      fetch
    })
  })

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
  test('should set first page and retrieve one smart account for every legacy account', (done) => {
    const keyIterator = new KeyIterator(seedPhrase)
    const PAGE_SIZE = 3
    accountAdder.init({ keyIterator, preselectedAccounts: [], pageSize: PAGE_SIZE })
    accountAdder.setPage({ page: 1, networks, providers })

    let emitCounter = 0
    accountAdder.onUpdate(() => {
      if (emitCounter === 0) {
        // First emit is triggered when account calculation is done
        expect(accountAdder.accountsOnPage.length).toEqual(
          // One smart account for every legacy account
          PAGE_SIZE * 2
        )
        expect(accountAdder.accountsLoading).toBe(false)
        expect(accountAdder.linkedAccountsLoading).toBe(false)
        done()
      }
      emitCounter++
    })
  })
  test('should start the searching for linked accounts', (done) => {
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({ keyIterator, preselectedAccounts: [], pageSize: 4 })
    accountAdder.setPage({ page: 1, networks, providers })

    let emitCounter = 0
    accountAdder.onUpdate(() => {
      // First emit is triggered when account calculation is done, int the
      // second emit it should start the searching for linked accounts
      if (emitCounter === 1) {
        expect(accountAdder.linkedAccountsLoading).toBe(true)
        done()
      }
      emitCounter++
    })
  })
  test('should find linked accounts', (done) => {
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({ keyIterator, preselectedAccounts: [], pageSize: 3 })
    accountAdder.setPage({ page: 1, networks, providers })

    let emitCounter = 0
    accountAdder.onUpdate(() => {
      // First emit is triggered when account calculation is done, int the
      // second emit it should start the searching for linked accounts,
      // on the third emit there should be linked accounts fetched
      if (emitCounter === 2) {
        expect(accountAdder.linkedAccountsLoading).toBe(false)
        const linkedAccountsOnPage = accountAdder.accountsOnPage.filter(
          ({ type }) => type === 'linked'
        )
        expect(linkedAccountsOnPage.length).toEqual(4)

        // One linked account on slot 1 and 3 linked accounts on slot 3.
        expect(linkedAccountsOnPage.filter(({ slot }) => slot === 1).length).toEqual(1)
        expect(linkedAccountsOnPage.filter(({ slot }) => slot === 2).length).toEqual(0)
        expect(linkedAccountsOnPage.filter(({ slot }) => slot === 3).length).toEqual(3)

        done()
      }
      emitCounter++
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
