import { JsonRpcProvider } from 'ethers'
import { Account } from 'interfaces/account'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
import { getLegacyAccount } from '../../libs/account/account'
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
const accountAdder = new AccountAdderController(produceMemoryStore(), relayerUrl)
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
    expect.assertions(3)
    expect((accountAdder as any)['#keyIterator']).toBe(undefined)
    expect((accountAdder as any).derivationPath).toBe(undefined)
    expect((accountAdder as any).page).toEqual(1)
  })
  test('should throw not initialized', async () => {
    expect.assertions(1)
    try {
      await accountAdder.getPage({ page: 1, networks, providers })
    } catch (e: any) {
      expect(e.message).toBe('accountAdder: keyIterator not initialized')
    }
  })
  test('should init keyIterator', () => {
    expect.assertions(2)
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({ _keyIterator: keyIterator, _preselectedAccounts: [] })
    expect((accountAdder as any)['#keyIterator']).toBe(undefined)
    expect((accountAdder as any).isReady).toBeTruthy()
  })
  test('should get first page', async () => {
    expect.assertions(2)
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({ _keyIterator: keyIterator, _preselectedAccounts: [], _pageSize: 1 })
    const accounts = await accountAdder.getPage({ page: 1, networks, providers })
    // Page size is 1 but for each slot there should be one legacy and one smart acc
    expect(accounts.length).toEqual(2)
    expect(accounts[0].addr).toEqual(keyPublicAddress)
  })
  test('search for linked accounts', async () => {
    expect.assertions(1)
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({ _keyIterator: keyIterator, _preselectedAccounts: [], _pageSize: 1 })
    const acc = getLegacyAccount(keyPublicAddress)
    const accounts = await accountAdder.searchForLinkedAccounts([acc])
    expect(accounts.length).toEqual(0)
  })
  test('should select account', async () => {
    expect.assertions(1)
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({ _keyIterator: keyIterator, _preselectedAccounts: [], _pageSize: 1 })
    accountAdder.selectAccount(legacyAccount)
    expect(accountAdder.selectedAccounts[0].addr).toBe(keyPublicAddress)
  })
  test('should deselect account', async () => {
    expect.assertions(1)
    accountAdder.deselectAccount(legacyAccount)
    expect(accountAdder.selectedAccounts[0]).toBe(undefined)
  })
  test('should not be able to deselect a preselected account', async () => {
    expect.assertions(1)
    try {
      const keyIterator = new KeyIterator(seedPhrase)
      accountAdder.init({
        _keyIterator: keyIterator,
        _preselectedAccounts: [legacyAccount],
        _pageSize: 1
      })
      accountAdder.selectedAccounts = [legacyAccount]
      await accountAdder.deselectAccount(legacyAccount)
    } catch (e: any) {
      expect(e.message).toBe('accountAdder: a preselected account cannot be deselected')
    }
  })
})
