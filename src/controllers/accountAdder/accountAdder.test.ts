import { JsonRpcProvider } from 'ethers'
import { Account } from 'interfaces/account'
import fetch from 'node-fetch'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
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

const relayerUrl = 'https://staging-relayer.ambire.com'

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

  // test('should initialize accountAdder', () => {
  //   expect(accountAdder.isInitialized).toBeFalsy()

  //   const keyIterator = new KeyIterator(seedPhrase)
  //   accountAdder.init({ keyIterator, preselectedAccounts: [legacyAccount] })

  //   expect(accountAdder.isInitialized).toBeTruthy()
  //   expect(accountAdder.preselectedAccounts).toContainEqual(legacyAccount)
  //   expect(accountAdder.selectedAccounts).toEqual([])
  // })

  test('should throw if operation is triggered, but the controller is not initialized yet', (done) => {
    accountAdder.setPage({ page: 1, networks, providers })

    let emitCounter = 0
    accountAdder.onError(() => {
      debugger
      emitCounter++

      if (emitCounter === 1) {
        const errors = accountAdder.getErrors()
        expect(errors.length).toEqual(1)
        expect(errors[0].error.message).toEqual(
          'accountAdder: requested method `#calculateAccounts`, but the AccountAdder is not initialized'
        )
        done()
      }
    })
  })

  // test('should set first page and retrieve one smart account for every legacy account', (done) => {
  //   const keyIterator = new KeyIterator(seedPhrase)
  //   const PAGE_SIZE = 3
  //   accountAdder.init({ keyIterator, preselectedAccounts: [], pageSize: PAGE_SIZE })
  //   accountAdder.setPage({ page: 1, networks, providers })

  //   let emitCounter = 0
  //   accountAdder.onUpdate(() => {
  //     emitCounter++

  //     if (emitCounter === 1) {
  //       // First emit is triggered when account calculation is done
  //       expect(accountAdder.accountsOnPage.length).toEqual(
  //         // One smart account for every legacy account
  //         PAGE_SIZE * 2
  //       )
  //       expect(accountAdder.accountsLoading).toBe(false)
  //       expect(accountAdder.linkedAccountsLoading).toBe(false)
  //       done()
  //     }
  //   })
  // })
  // test('should start the searching for linked accounts', (done) => {
  //   const keyIterator = new KeyIterator(seedPhrase)
  //   accountAdder.init({ keyIterator, preselectedAccounts: [], pageSize: 4 })
  //   accountAdder.setPage({ page: 1, networks, providers })

  //   let emitCounter = 0
  //   accountAdder.onUpdate(() => {
  //     emitCounter++

  //     // First emit is triggered when account calculation is done, int the
  //     // second emit it should start the searching for linked accounts
  //     if (emitCounter === 2) {
  //       expect(accountAdder.linkedAccountsLoading).toBe(true)
  //       done()
  //     }
  //   })
  // })
  // test('should find linked accounts', (done) => {
  //   const keyIterator = new KeyIterator(seedPhrase)
  //   accountAdder.init({ keyIterator, preselectedAccounts: [], pageSize: 3 })
  //   accountAdder.setPage({ page: 1, networks, providers })

  //   let emitCounter = 0
  //   accountAdder.onUpdate(() => {
  //     emitCounter++

  //     // First emit is triggered when account calculation is done, int the
  //     // second emit it should start the searching for linked accounts,
  //     // on the third emit there should be linked accounts fetched
  //     if (emitCounter === 3) {
  //       expect(accountAdder.linkedAccountsLoading).toBe(false)
  //       const linkedAccountsOnPage = accountAdder.accountsOnPage.filter(({ isLinked }) => isLinked)
  //       expect(linkedAccountsOnPage.length).toEqual(4)

  //       // One linked account on slot 1 and 3 linked accounts on slot 3.
  //       expect(linkedAccountsOnPage.filter(({ slot }) => slot === 1).length).toEqual(1)
  //       expect(linkedAccountsOnPage.filter(({ slot }) => slot === 2).length).toEqual(0)
  //       expect(linkedAccountsOnPage.filter(({ slot }) => slot === 3).length).toEqual(3)

  //       done()
  //     }
  //   })
  // })
  // test('should not be able to deselect a preselected account', async () => {
  //   const keyIterator = new KeyIterator(seedPhrase)
  //   accountAdder.init({ keyIterator, preselectedAccounts: [legacyAccount], pageSize: 1 })
  //   accountAdder.selectedAccounts = [legacyAccount]

  //   await expect(accountAdder.deselectAccount(legacyAccount)).rejects.toThrow(
  //     'accountAdder: a preselected account cannot be deselected'
  //   )
  // })
})
