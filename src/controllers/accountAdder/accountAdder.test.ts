/* eslint-disable @typescript-eslint/no-floating-promises */
import { JsonRpcProvider, Wallet } from 'ethers'
import fetch from 'node-fetch'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import {
  BIP44_STANDARD_DERIVATION_TEMPLATE,
  SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
} from '../../consts/derivation'
import { networks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { isSmartAccount } from '../../libs/account/account'
import { getPrivateKeyFromSeed, KeyIterator } from '../../libs/keyIterator/keyIterator'
import { KeystoreController } from '../keystore/keystore'
import { AccountAdderController, DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from './accountAdder'

const providers = Object.fromEntries(
  networks.map((network) => [network.id, new JsonRpcProvider(network.rpcUrl)])
)

const relayerUrl = 'https://staging-relayer.ambire.com'

const key1to11BasicAccPublicAddresses = Array.from(
  { length: 11 },
  (_, i) =>
    new Wallet(getPrivateKeyFromSeed(process.env.SEED, i, BIP44_STANDARD_DERIVATION_TEMPLATE))
      .address
)

const key1to11BasicAccUsedForSmartAccKeysOnlyPublicAddresses = Array.from(
  { length: 11 },
  (_, i) =>
    new Wallet(
      getPrivateKeyFromSeed(
        process.env.SEED,
        i + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET,
        BIP44_STANDARD_DERIVATION_TEMPLATE
      )
    ).address
)

const key1PublicAddress = key1to11BasicAccPublicAddresses[0]

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
      relayerUrl,
      fetch
    })
  })

  test('should initialize', (done) => {
    let emitCounter = 0
    const unsubscribe = accountAdder.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        expect(accountAdder.page).toEqual(DEFAULT_PAGE)
        expect(accountAdder.pageSize).toEqual(DEFAULT_PAGE_SIZE)
        expect(accountAdder.isInitialized).toBeTruthy()
        expect(accountAdder.selectedAccounts).toEqual([])
        expect(accountAdder.hdPathTemplate).toEqual(BIP44_STANDARD_DERIVATION_TEMPLATE)

        unsubscribe()
        done()
      }
    })

    const keyIterator = new KeyIterator(process.env.SEED)
    accountAdder.init({
      keyIterator,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
  })

  test('should throw if AccountAdder controller method is requested, but the controller was not initialized beforehand', (done) => {
    const unsubscribe = accountAdder.onError(() => {
      const notInitializedErrorsCount = accountAdder.emittedErrors.filter(
        (e) =>
          e.error.message ===
          'accountAdder: requested a method of the AccountAdder controller, but the controller was not initialized'
      ).length

      if (notInitializedErrorsCount === 4) {
        expect(notInitializedErrorsCount).toEqual(4)
        unsubscribe()
        done()
      }
    })

    accountAdder.setPage({ page: 1, networks, providers })
    accountAdder.selectAccount(basicAccount)
    accountAdder.deselectAccount(basicAccount)
    accountAdder.addAccounts([], {}, { internal: [], external: [] }, [])
  })

  test('should throw if AccountAdder controller gets initialized, but the keyIterator is missing', (done) => {
    const unsubscribe = accountAdder.onError(() => {
      const missingKeyIteratorError = accountAdder.emittedErrors.find(
        (e) => e.error.message === 'accountAdder: missing keyIterator'
      )

      if (missingKeyIteratorError) {
        expect(missingKeyIteratorError).toBeTruthy()
        unsubscribe()
        done()
      }
    })

    accountAdder.init({ keyIterator: null, hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE })
  })

  test('should retrieve one smart account and one basic account on every slot (per page)', (done) => {
    const PAGE_SIZE = 11

    let emitCounter = 0
    const unsubscribe = accountAdder.onUpdate(() => {
      emitCounter++

      // Trigger when the accountsLoading resolves (first emit gets skipped, because it's the initial state)
      if (emitCounter > 1 && !accountAdder.accountsLoading) {
        // There should be one basic and one smart account on each slot, meaning
        // there should be PAGE_SIZE * 2 accounts on the page (without the linked ones)
        const allAccountsExceptLinked = accountAdder.accountsOnPage.filter((x) => !x.isLinked)
        expect(allAccountsExceptLinked).toHaveLength(PAGE_SIZE * 2)

        // Check the Basic Addresses retrieved
        const basicAccountAddressesOnPage = accountAdder.accountsOnPage
          .filter((x) => !isSmartAccount(x.account))
          .map((x) => x.account.addr)
        expect(basicAccountAddressesOnPage).toHaveLength(PAGE_SIZE)
        expect(basicAccountAddressesOnPage).toEqual(key1to11BasicAccPublicAddresses)

        // Check the Smart Addresses retrieved
        const smartAccountAddressesOnPage = accountAdder.accountsOnPage.filter((x) =>
          isSmartAccount(x.account)
        )
        expect(smartAccountAddressesOnPage).toHaveLength(PAGE_SIZE)
        // TODO: Check if the calculated smart account addresses are connect
        // expect(basicAccountAddressesOnPage).toEqual(key1to11SmartAccPublicAddresses)

        // Smart account associated keys should be different than the basic
        // account addresses, since we use derived addresses for the smart account keys
        const noneOfTheSmartAccountsShouldHaveBasicAccountsAsAssociatedKeys =
          smartAccountAddressesOnPage.every(
            (x) => !x.account.associatedKeys.some((y) => basicAccountAddressesOnPage.includes(y))
          )
        expect(noneOfTheSmartAccountsShouldHaveBasicAccountsAsAssociatedKeys).toBeTruthy()

        // Smart account associated keys should be the special derived addresses
        const allSmartAccAssociatedKeysAddresses = smartAccountAddressesOnPage.flatMap(
          (x) => x.account.associatedKeys
        )
        expect(allSmartAccAssociatedKeysAddresses).toEqual(
          key1to11BasicAccUsedForSmartAccKeysOnlyPublicAddresses
        )

        unsubscribe()
        done()
      }
    })

    const keyIterator = new KeyIterator(process.env.SEED)
    accountAdder.init({
      keyIterator,
      pageSize: PAGE_SIZE,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    accountAdder.setPage({ page: 1, networks, providers })
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
    // FIXME: temporary workaround for done() being called multiple times
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
