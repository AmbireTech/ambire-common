import { JsonRpcProvider } from 'ethers'
import { Account } from 'interfaces/account'
import fetch from 'node-fetch'

/* eslint-disable no-new */
import { describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
import { KeyIterator } from '../../libs/keyIterator/keyIterator'
import { AccountAdderController } from './accountAdder'

jest.mock('node-fetch', () => {
  return jest.fn((url: any) => {
    // @ts-ignore
    const { Response } = jest.requireActual('node-fetch')
    if (url.includes('/identity/any/by-owner/')) {
      const body = JSON.stringify({
        '0x87C825a897C65F4E5D8FA2FECE428c41BbfdB772':
          '0x0000000000000000000000000000000000000000000000000000000000000001'
      })
      const headers = { status: 200 }

      return Promise.resolve(new Response(body, headers))
    }

    // @ts-ignore
    return jest.requireActual('node-fetch')(url)
  })
})

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
// const fetch = () =>
//   Promise.resolve({
//     status: 200,
//     success: true
//   })

const accountAdder = new AccountAdderController({
  storage: produceMemoryStore(),
  relayerUrl,
  fetch
})

const seedPhrase =
  'brisk rich glide impose category stuff company you appear remain decorate monkey'
const privKey = '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
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
    // expect.assertions(2)
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({ keyIterator, preselectedAccounts: [], pageSize: 1 })
    accountAdder.setPage({ page: 1, networks, providers })
    await new Promise((resolve) => {
      accountAdder.onUpdate(() => {
        // Page size is 1 but for each slot there should be one legacy and one smart acc
        expect(accountAdder.accountsOnPage.length).toEqual(2)
        // expect(accountAdder.pageAddresses[0].addr).toEqual(keyPublicAddress)
        resolve(null)
      })
    })
    await new Promise((resolve) => {
      accountAdder.onUpdate(() => {
        // Page size is 1 but for each slot there should be one legacy and one smart acc
        expect(accountAdder.accountsOnPage.length).toEqual(2)
        // expect(accountAdder.pageAddresses[0].addr).toEqual(keyPublicAddress)
        resolve(null)
      })
    })
  })
  // test('search for linked accounts', async () => {
  //   const keyIterator = new KeyIterator(seedPhrase)
  //   accountAdder.init({ _keyIterator: keyIterator, _preselectedAccounts: [], _pageSize: 1 })
  //   const acc = getLegacyAccount(keyPublicAddress)
  //   accountAdder.searchForLinkedAccounts([acc])
  //   await new Promise((resolve) => {
  //     accountAdder.onUpdate(() => {
  //       expect(accountAdder.linkedAccounts.length).toEqual(0)
  //       expect(accountAdder.searchingLinkedAccounts).toBe(false)
  //       resolve(null)
  //     })
  //   })
  // })
  // test('should select account', async () => {
  //   const keyIterator = new KeyIterator(seedPhrase)
  //   accountAdder.init({ _keyIterator: keyIterator, _preselectedAccounts: [], _pageSize: 1 })
  //   accountAdder.selectAccount(legacyAccount)
  //   expect(accountAdder.selectedAccounts[0].addr).toBe(keyPublicAddress)
  // })
  // test('should deselect account', async () => {
  //   accountAdder.deselectAccount(legacyAccount)
  //   expect(accountAdder.selectedAccounts[0]).toBe(undefined)
  // })
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
