import { JsonRpcProvider, Wallet } from 'ethers'
import { Account } from 'interfaces/account'
import fetch from 'node-fetch'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { networks } from '../../consts/networks'
import { getPrivateKeyFromSeed, KeyIterator } from '../../libs/keyIterator/keyIterator'
import { KeystoreController } from '../keystore/keystore'
import { AccountAdderController } from './accountAdder'

const providers = Object.fromEntries(
  networks.map((network) => [network.id, new JsonRpcProvider(network.rpcUrl)])
)

const relayerUrl = 'https://staging-relayer.ambire.com'

const key1PublicAddress = new Wallet(
  getPrivateKeyFromSeed(process.env.SEED, 0, BIP44_STANDARD_DERIVATION_TEMPLATE)
).address

const basicAccount: Account = {
  addr: key1PublicAddress,
  associatedKeys: [key1PublicAddress],
  initialPrivileges: [
    [key1PublicAddress, '0x0000000000000000000000000000000000000000000000000000000000000001']
  ],
  creation: null
}

describe('AccountAdder', () => {
  let accountAdder: AccountAdderController
  beforeEach(() => {
    accountAdder = new AccountAdderController({
      alreadyImportedAccounts: [],
      keystore: new KeystoreController(produceMemoryStore(), {}),
      storage: produceMemoryStore(),
      relayerUrl,
      fetch
    })
  })

  test('should initialize accountAdder', () => {
    expect(accountAdder.isInitialized).toBeFalsy()

    const keyIterator = new KeyIterator(process.env.SEED)
    accountAdder.init({
      keyIterator,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })

    expect(accountAdder.isInitialized).toBeTruthy()
    expect(accountAdder.selectedAccounts).toEqual([])
  })

  test('should throw if operation is triggered, but the controller is not initialized yet', (done) => {
    let emitCounter = 0
    const unsubscribe = accountAdder.onError(() => {
      emitCounter++

      if (emitCounter === 1) {
        const errors = accountAdder.emittedErrors
        expect(errors.length).toEqual(1)
        expect(errors[0].error.message).toEqual(
          'accountAdder: requested method `#deriveAccounts`, but the AccountAdder is not initialized'
        )
        unsubscribe()
        done()
      }
    })

    accountAdder.setPage({ page: 1, networks, providers })
  })

  test('should set first page and retrieve one smart account for every basic account', (done) => {
    const keyIterator = new KeyIterator(process.env.SEED)
    const PAGE_SIZE = 3
    accountAdder.init({
      keyIterator,
      pageSize: PAGE_SIZE,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    accountAdder.setPage({ page: 1, networks, providers })

    let emitCounter = 0
    const unsubscribe = accountAdder.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        // First emit is triggered when account derivation is done
        expect(accountAdder.accountsOnPage.length).toEqual(
          // One smart account for every basic account
          PAGE_SIZE * 2
        )
        expect(accountAdder.accountsLoading).toBe(false)
        expect(accountAdder.linkedAccountsLoading).toBe(false)
        unsubscribe()
        done()
      }
    })
  })
  test('should start the searching for linked accounts', (done) => {
    const keyIterator = new KeyIterator(process.env.SEED)
    accountAdder.init({
      keyIterator,
      pageSize: 4,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    accountAdder.setPage({ page: 1, networks, providers })

    let emitCounter = 0
    const unsubscribe = accountAdder.onUpdate(() => {
      emitCounter++

      // First emit is triggered when account derivation is done, int the
      // second emit it should start the searching for linked accounts
      if (emitCounter === 2) {
        expect(accountAdder.linkedAccountsLoading).toBe(true)
        unsubscribe()
        done()
      }
    })
  })
  test('should find linked accounts', (done) => {
    const keyIterator = new KeyIterator(process.env.SEED)
    accountAdder.init({
      keyIterator,
      pageSize: 3,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    accountAdder.setPage({ page: 1, networks, providers })

    let emitCounter = 0
    const unsubscribe = accountAdder.onUpdate(() => {
      emitCounter++

      // First emit is triggered when account derivation is done, int the
      // second emit it should start the searching for linked accounts,
      // on the third emit there should be linked accounts fetched
      if (emitCounter === 3) {
        expect(accountAdder.linkedAccountsLoading).toBe(false)
        const linkedAccountsOnPage = accountAdder.accountsOnPage.filter(({ isLinked }) => isLinked)

        const accountsOnSlot1 = linkedAccountsOnPage
          .filter(({ slot }) => slot === 1)
          .map(({ account }) => account.addr)
        expect(accountsOnSlot1).toContain('0x740523d7876Fbb8AF246c5B307f26d4b2D2BFDA9')

        const accountsOnSlot3 = linkedAccountsOnPage
          .filter(({ slot }) => slot === 3)
          .map(({ account }) => account.addr)
        expect(accountsOnSlot3).toContain('0x0ace96748e66F42EBeA22D777C2a99eA2c83D8A6')
        expect(accountsOnSlot3).toContain('0xc583f33d502dE560dd2C60D4103043d5998A98E5')
        expect(accountsOnSlot3).toContain('0x63caaD57Cd66A69A4c56b595E3A4a1e4EeA066d8')
        expect(accountsOnSlot3).toContain('0x619A6a273c628891dD0994218BC0625947653AC7')
        expect(accountsOnSlot3).toContain('0x7ab87ab041EB1c4f0d4f4d1ABD5b0973B331e2E7')
        unsubscribe()
        done()
      }
    })
  })
  test('should be able to deselect an account', (done) => {
    let emitCounter = 0
    let doneCalled = false
    const unsubscribe = accountAdder.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        accountAdder.selectedAccounts = [
          {
            account: basicAccount,
            accountKeys: [{ addr: basicAccount.addr, slot: 1, index: 0 }],
            isLinked: false
          }
        ]

        expect(
          accountAdder.selectedAccounts.map((a) => a.account.addr).includes(basicAccount.addr)
        ).toBeTruthy()

        accountAdder.deselectAccount(basicAccount)
      }

      if (emitCounter === 2) {
        expect(accountAdder.selectedAccounts).toEqual([])
        unsubscribe()
        if (!doneCalled) {
          doneCalled = true
          done()
        }
      }
    })

    const keyIterator = new KeyIterator(process.env.SEED)
    accountAdder.init({
      keyIterator,
      pageSize: 1,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
  })
})
