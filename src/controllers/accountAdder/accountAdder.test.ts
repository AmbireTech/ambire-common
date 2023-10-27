import { JsonRpcProvider } from 'ethers'
import { Account } from 'interfaces/account'
import fetch from 'node-fetch'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { networks } from '../../consts/networks'
import { KeyIterator } from '../../libs/keyIterator/keyIterator'
import { AccountAdderController } from './accountAdder'

const providers = Object.fromEntries(
  networks.map((network) => [network.id, new JsonRpcProvider(network.rpcUrl)])
)

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

  test('should initialize accountAdder', () => {
    expect(accountAdder.isInitialized).toBeFalsy()

    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({
      keyIterator,
      preselectedAccounts: [legacyAccount],
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })

    expect(accountAdder.isInitialized).toBeTruthy()
    expect(accountAdder.preselectedAccounts).toContainEqual(legacyAccount)
    expect(accountAdder.selectedAccounts).toEqual([])
  })

  test('should throw if operation is triggered, but the controller is not initialized yet', (done) => {
    let emitCounter = 0
    accountAdder.onError(() => {
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

    accountAdder.setPage({ page: 1, networks, providers })
  })

  test('should set first page and retrieve one smart account for every legacy account', (done) => {
    const keyIterator = new KeyIterator(seedPhrase)
    const PAGE_SIZE = 3
    accountAdder.init({
      keyIterator,
      preselectedAccounts: [],
      pageSize: PAGE_SIZE,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    accountAdder.setPage({ page: 1, networks, providers })

    let emitCounter = 0
    accountAdder.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        // First emit is triggered when account calculation is done
        expect(accountAdder.accountsOnPage.length).toEqual(
          // One smart account for every legacy account
          PAGE_SIZE * 2
        )
        expect(accountAdder.accountsLoading).toBe(false)
        expect(accountAdder.linkedAccountsLoading).toBe(false)
        done()
      }
    })
  })
  test('should start the searching for linked accounts', (done) => {
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({
      keyIterator,
      preselectedAccounts: [],
      pageSize: 4,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    accountAdder.setPage({ page: 1, networks, providers })

    let emitCounter = 0
    accountAdder.onUpdate(() => {
      emitCounter++

      // First emit is triggered when account calculation is done, int the
      // second emit it should start the searching for linked accounts
      if (emitCounter === 2) {
        expect(accountAdder.linkedAccountsLoading).toBe(true)
        done()
      }
    })
  })
  test('should find linked accounts', (done) => {
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({
      keyIterator,
      preselectedAccounts: [],
      pageSize: 3,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    accountAdder.setPage({ page: 1, networks, providers })

    let emitCounter = 0
    accountAdder.onUpdate(() => {
      emitCounter++

      // First emit is triggered when account calculation is done, int the
      // second emit it should start the searching for linked accounts,
      // on the third emit there should be linked accounts fetched
      if (emitCounter === 3) {
        expect(accountAdder.linkedAccountsLoading).toBe(false)
        const linkedAccountsOnPage = accountAdder.accountsOnPage.filter(({ isLinked }) => isLinked)

        const accountsOnSlot1 = linkedAccountsOnPage
          .filter(({ slot }) => slot === 1)
          .map(({ account }) => account.addr)
        expect(accountsOnSlot1).toContain('0x740523d7876Fbb8AF246c5B307f26d4b2D2BFDA9')

        expect(linkedAccountsOnPage.filter(({ slot }) => slot === 2).length).toEqual(1)

        const accountsOnSlot3 = linkedAccountsOnPage
          .filter(({ slot }) => slot === 3)
          .map(({ account }) => account.addr)
        expect(accountsOnSlot3).toContain('0x63caaD57Cd66A69A4c56b595E3A4a1e4EeA066d8')
        expect(accountsOnSlot3).toContain('0x619A6a273c628891dD0994218BC0625947653AC7')
        expect(accountsOnSlot3).toContain('0x7ab87ab041EB1c4f0d4f4d1ABD5b0973B331e2E7')
        done()
      }
    })
  })
  test('should not be able to deselect a preselected account', (done) => {
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({
      keyIterator,
      preselectedAccounts: [legacyAccount],
      pageSize: 1,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
    })
    accountAdder.selectedAccounts = [
      { ...legacyAccount, eoaAddress: key1PublicAddress, slot: 1, isLinked: false }
    ]

    let emitCounter = 0
    accountAdder.onError(() => {
      emitCounter++

      if (emitCounter === 1) {
        const errors = accountAdder.getErrors()
        expect(errors.length).toEqual(1)
        expect(errors[0].error.message).toEqual(
          'accountAdder: a preselected account cannot be deselected'
        )
        done()
      }
    })

    accountAdder.deselectAccount(legacyAccount)
  })
})
