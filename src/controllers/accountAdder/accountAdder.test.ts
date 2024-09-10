/* eslint-disable @typescript-eslint/no-floating-promises */
import { Wallet } from 'ethers'
import fetch from 'node-fetch'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { relayerUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import {
  BIP44_STANDARD_DERIVATION_TEMPLATE,
  DERIVATION_OPTIONS,
  SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
} from '../../consts/derivation'
import { networks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { Storage } from '../../interfaces/storage'
import { isSmartAccount } from '../../libs/account/account'
import { getPrivateKeyFromSeed, KeyIterator } from '../../libs/keyIterator/keyIterator'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { AccountAdderController, DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from './accountAdder'

const providers = Object.fromEntries(
  networks.map((network) => [network.id, getRpcProvider(network.rpcUrls, network.chainId)])
)

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
const key1PrivateKey = getPrivateKeyFromSeed(
  process.env.SEED,
  0,
  BIP44_STANDARD_DERIVATION_TEMPLATE
)
const key1UsedForSmartAccKeysOnlyPrivateKey = getPrivateKeyFromSeed(
  process.env.SEED,
  SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET,
  BIP44_STANDARD_DERIVATION_TEMPLATE
)
const key2UsedForSmartAccKeysOnlyPrivateKey = getPrivateKeyFromSeed(
  process.env.SEED,
  1 + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET,
  BIP44_STANDARD_DERIVATION_TEMPLATE
)

const basicAccount: Account = {
  addr: key1PublicAddress,
  associatedKeys: [key1PublicAddress],
  initialPrivileges: [
    [key1PublicAddress, '0x0000000000000000000000000000000000000000000000000000000000000001']
  ],
  creation: null,
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: key1PublicAddress
  }
}

describe('AccountAdder', () => {
  let accountAdder: AccountAdderController
  const storage: Storage = produceMemoryStore()
  let providersCtrl: ProvidersController
  const networksCtrl = new NetworksController(
    storage,
    fetch,
    (net) => {
      providersCtrl.setProvider(net)
    },
    (id) => {
      providersCtrl.removeProvider(id)
    }
  )
  providersCtrl = new ProvidersController(networksCtrl)
  providersCtrl.providers = providers

  const accountsCtrl = new AccountsController(
    storage,
    providersCtrl,
    networksCtrl,
    () => {},
    () => {}
  )
  beforeEach(() => {
    accountAdder = new AccountAdderController({
      accounts: accountsCtrl,
      keystore: new KeystoreController(storage, {}),
      networks: networksCtrl,
      providers: providersCtrl,
      relayerUrl,
      fetch
    })
  })

  test('should initialize', async () => {
    const keyIterator = new KeyIterator(process.env.SEED)
    const hdPathTemplate = BIP44_STANDARD_DERIVATION_TEMPLATE
    await accountAdder.init({ keyIterator, hdPathTemplate })

    expect(accountAdder.page).toEqual(DEFAULT_PAGE)
    expect(accountAdder.pageSize).toEqual(DEFAULT_PAGE_SIZE)
    expect(accountAdder.isInitialized).toBeTruthy()
    expect(accountAdder.isInitializedWithDefaultSeed).toBeFalsy()
    expect(accountAdder.selectedAccounts).toEqual([])
    expect(accountAdder.hdPathTemplate).toEqual(hdPathTemplate)
    expect(accountAdder.shouldGetAccountsUsedOnNetworks).toBeTruthy()
    expect(accountAdder.shouldSearchForLinkedAccounts).toBeTruthy()
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

    accountAdder.setPage({ page: 1 })
    accountAdder.selectAccount(basicAccount)
    accountAdder.deselectAccount(basicAccount)
    accountAdder.addAccounts([], { internal: [], external: [] })
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

  test('should retrieve one smart account and one basic account on every slot (per page)', async () => {
    const PAGE_SIZE = 11
    const keyIterator = new KeyIterator(process.env.SEED)
    await accountAdder.init({
      keyIterator,
      pageSize: PAGE_SIZE,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldGetAccountsUsedOnNetworks: false
    })
    accountAdder.setPage({ page: 1 })

    return new Promise((resolve) => {
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
          resolve(null)
        }
      })
    })
  })

  test('should start the searching for linked accounts', async () => {
    const keyIterator = new KeyIterator(process.env.SEED)
    await accountAdder.init({
      keyIterator,
      pageSize: 4,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldGetAccountsUsedOnNetworks: false
    })

    accountAdder.setPage({ page: 1 })

    return new Promise((resolve) => {
      let emitCounter = 0
      const unsubscribe = accountAdder.onUpdate(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        emitCounter++

        if (accountAdder.linkedAccountsLoading) {
          expect(accountAdder.linkedAccountsLoading).toBe(true)
          unsubscribe()
          resolve(null)
        }
      })
    })
  })

  test('should find linked accounts', async () => {
    const keyIterator = new KeyIterator(process.env.SEED)
    await accountAdder.init({
      keyIterator,
      pageSize: 3,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldGetAccountsUsedOnNetworks: false
    })
    await accountAdder.setPage({ page: 1 })

    expect(accountAdder.linkedAccountsLoading).toBe(false)
    const linkedAccountsOnPage = accountAdder.accountsOnPage.filter(({ isLinked }) => isLinked)

    const accountsOnSlot1 = linkedAccountsOnPage
      .filter(({ slot }) => slot === 1)
      .map(({ account }) => account.addr)
    // This account was manually added as a signer to one of our test accounts
    expect(accountsOnSlot1).toContain('0x740523d7876Fbb8AF246c5B307f26d4b2D2BFDA9')

    const accountsOnSlot3 = linkedAccountsOnPage
      .filter(({ slot }) => slot === 3)
      .map(({ account }) => account.addr)
    // These accounts was manually added as signers to our test accounts
    expect(accountsOnSlot3).toContain('0x0ace96748e66F42EBeA22D777C2a99eA2c83D8A6')
    expect(accountsOnSlot3).toContain('0xc583f33d502dE560dd2C60D4103043d5998A98E5')
    expect(accountsOnSlot3).toContain('0x63caaD57Cd66A69A4c56b595E3A4a1e4EeA066d8')
    expect(accountsOnSlot3).toContain('0x619A6a273c628891dD0994218BC0625947653AC7')
    expect(accountsOnSlot3).toContain('0x7ab87ab041EB1c4f0d4f4d1ABD5b0973B331e2E7')
  })

  test('should be able to select and then deselect an account', async () => {
    const keyIterator = new KeyIterator(process.env.SEED)
    await accountAdder.init({
      keyIterator,
      pageSize: 1,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldSearchForLinkedAccounts: false,
      shouldGetAccountsUsedOnNetworks: false
    })
    await accountAdder.setPage({ page: 1 })

    accountAdder.selectAccount(basicAccount)
    const selectedAccountAddr = accountAdder.selectedAccounts.map((a) => a.account.addr)
    expect(selectedAccountAddr).toContain(basicAccount.addr)

    accountAdder.deselectAccount(basicAccount)
    expect(accountAdder.selectedAccounts).toHaveLength(0)
  })

  test('should NOT be able to select the same account more than once', async () => {
    const keyIterator = new KeyIterator(process.env.SEED)
    await accountAdder.init({
      keyIterator,
      pageSize: 1,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldSearchForLinkedAccounts: false,
      shouldGetAccountsUsedOnNetworks: false
    })
    await accountAdder.setPage({ page: 1 })

    accountAdder.selectAccount(basicAccount)
    accountAdder.selectAccount(basicAccount)
    accountAdder.selectAccount(basicAccount)

    expect(accountAdder.selectedAccounts).toHaveLength(1)
    const selectedAccountAddr = accountAdder.selectedAccounts.map((a) => a.account.addr)
    expect(selectedAccountAddr).toContain(basicAccount.addr)
  })

  test('should be able to select all the keys of a selected basic account (always one key)', async () => {
    const keyIterator = new KeyIterator(process.env.SEED)
    await accountAdder.init({
      keyIterator,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldSearchForLinkedAccounts: false,
      shouldGetAccountsUsedOnNetworks: false
    })
    await accountAdder.setPage({ page: 1 })

    accountAdder.selectAccount(basicAccount)

    expect(accountAdder.selectedAccounts[0].accountKeys).toHaveLength(1)
    const keyAddr = accountAdder.selectedAccounts[0].accountKeys[0].addr
    const keyIndex = accountAdder.selectedAccounts[0].accountKeys[0].index
    expect(keyAddr).toEqual(basicAccount.addr)
    expect(keyIndex).toEqual(0)
  })

  test('should be able to select all the keys of a selected smart account (derived key)', async () => {
    const keyIterator = new KeyIterator(process.env.SEED)
    await accountAdder.init({
      keyIterator,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldSearchForLinkedAccounts: false,
      shouldGetAccountsUsedOnNetworks: false
    })
    await accountAdder.setPage({ page: 1 })

    const firstSmartAccount = accountAdder.accountsOnPage.find(
      (x) => x.slot === 1 && isSmartAccount(x.account)
    )
    if (firstSmartAccount) accountAdder.selectAccount(firstSmartAccount.account)

    expect(accountAdder.selectedAccounts[0].accountKeys)
      // Might contain other keys too, but this one should be in there,
      // since that's the derived used only for smart account key
      .toContainEqual({
        addr: key1to11BasicAccUsedForSmartAccKeysOnlyPublicAddresses[0],
        index: SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET,
        slot: 1
      })
  })

  test('should retrieve all internal keys selected 1) basic accounts and 2) smart accounts', async () => {
    const keyIterator = new KeyIterator(process.env.SEED)
    await accountAdder.init({
      keyIterator,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldSearchForLinkedAccounts: false,
      shouldGetAccountsUsedOnNetworks: false
    })
    await accountAdder.setPage({ page: 1 })

    accountAdder.selectAccount(basicAccount)
    const firstSmartAccount = accountAdder.accountsOnPage.find(
      (x) => x.slot === 1 && isSmartAccount(x.account)
    )
    const secondSmartAccount = accountAdder.accountsOnPage.find(
      (x) => x.slot === 2 && isSmartAccount(x.account)
    )
    if (firstSmartAccount) accountAdder.selectAccount(firstSmartAccount.account)
    if (secondSmartAccount) accountAdder.selectAccount(secondSmartAccount.account)

    const internalKeys = accountAdder.retrieveInternalKeysOfSelectedAccounts()

    expect(internalKeys).toHaveLength(3)
    const firstKey = internalKeys.filter((k) => k.privateKey === key1PrivateKey)[0]
    const secondKey = internalKeys.filter(
      (k) => k.privateKey === key1UsedForSmartAccKeysOnlyPrivateKey
    )[0]
    const thirdKey = internalKeys.filter(
      (k) => k.privateKey === key2UsedForSmartAccKeysOnlyPrivateKey
    )[0]

    expect(firstKey).toEqual(
      expect.objectContaining({
        privateKey: key1PrivateKey,
        label: 'Key 1',
        dedicatedToOneSA: false
      })
    )
    expect(secondKey).toEqual(
      expect.objectContaining({
        privateKey: key1UsedForSmartAccKeysOnlyPrivateKey,
        label: 'Key 1',
        dedicatedToOneSA: true
      })
    )
    expect(thirdKey).toEqual(
      expect.objectContaining({
        privateKey: key2UsedForSmartAccKeysOnlyPrivateKey,
        label: 'Key 1',
        dedicatedToOneSA: true
      })
    )
  })

  DERIVATION_OPTIONS.forEach(({ label, value }) => {
    test(`should derive correctly ${label}`, async () => {
      const keyIterator = new KeyIterator(process.env.SEED)
      const pageSize = 5
      await accountAdder.init({
        keyIterator,
        hdPathTemplate: value,
        pageSize,
        shouldSearchForLinkedAccounts: false,
        shouldGetAccountsUsedOnNetworks: false
      })

      // Checks page 1 Basic Accounts
      await accountAdder.setPage({ page: 1 })
      const basicAccountsOnFirstPage = accountAdder.accountsOnPage.filter(
        (x) => !isSmartAccount(x.account)
      )
      const key1to5BasicAccPublicAddresses = Array.from(
        { length: pageSize },
        (_, i) => new Wallet(getPrivateKeyFromSeed(process.env.SEED, i, value)).address
      )
      basicAccountsOnFirstPage.forEach((x) => {
        const address = x.account.addr
        expect(address).toBe(key1to5BasicAccPublicAddresses[x.index])
      })

      // Checks page 2 Basic Accounts
      await accountAdder.setPage({ page: 2 })
      const basicAccountsOnSecondPage = accountAdder.accountsOnPage.filter(
        (x) => !isSmartAccount(x.account)
      )
      const key6to10BasicAccPublicAddresses = Array.from(
        { length: pageSize },
        (_, i) => new Wallet(getPrivateKeyFromSeed(process.env.SEED, i + pageSize, value)).address
      )
      basicAccountsOnSecondPage.forEach((x) => {
        const address = x.account.addr
        expect(address).toBe(key6to10BasicAccPublicAddresses[x.index - pageSize])
      })
    })
  })
})
