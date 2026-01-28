/* eslint-disable @typescript-eslint/no-floating-promises */
import { Wallet } from 'ethers'
import fetch from 'node-fetch'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { relayerUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { mockUiManager } from '../../../test/helpers/ui'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import {
  BIP44_STANDARD_DERIVATION_TEMPLATE,
  DERIVATION_OPTIONS,
  SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
} from '../../consts/derivation'
import { Account } from '../../interfaces/account'
import { IProvidersController } from '../../interfaces/provider'
import { Storage } from '../../interfaces/storage'
import { isSmartAccount } from '../../libs/account/account'
import { getPrivateKeyFromSeed, KeyIterator } from '../../libs/keyIterator/keyIterator'
import wait from '../../utils/wait'
import { AccountsController } from '../accounts/accounts'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { AccountPickerController, DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from './accountPicker'

const key1to11BasicAccPublicAddresses = Array.from(
  { length: 11 },
  (_, i) =>
    new Wallet(getPrivateKeyFromSeed(process.env.SEED, null, i, BIP44_STANDARD_DERIVATION_TEMPLATE))
      .address
)

const key1to11BasicAccUsedForSmartAccKeysOnlyPublicAddresses = Array.from(
  { length: 11 },
  (_, i) =>
    new Wallet(
      getPrivateKeyFromSeed(
        process.env.SEED,
        null,
        i + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET,
        BIP44_STANDARD_DERIVATION_TEMPLATE
      )
    ).address
)

const key1PublicAddress = key1to11BasicAccPublicAddresses[0]!
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

const prepareTest = async () => {
  const storage: Storage = produceMemoryStore()
  let providersCtrl: IProvidersController
  const storageCtrl = new StorageController(storage)
  const networksCtrl = new NetworksController({
    storage: storageCtrl,
    fetch,
    relayerUrl,
    getProvider: (chainId) => {
      return providersCtrl.providers[chainId.toString()]!
    },
    onAddOrUpdateNetworks: () => {}
  })
  const { uiManager } = mockUiManager()
  const uiCtrl = new UiController({ uiManager })
  providersCtrl = new ProvidersController(networksCtrl, storageCtrl, uiCtrl)

  const keystoreController = new KeystoreController('default', storageCtrl, {}, uiCtrl)

  const accountsCtrl = new AccountsController(
    storageCtrl,
    providersCtrl,
    networksCtrl,
    keystoreController,
    () => {},
    () => {},
    () => {},
    relayerUrl,
    fetch
  )

  await accountsCtrl.initialLoadPromise
  await providersCtrl.initialLoadPromise
  await networksCtrl.initialLoadPromise

  const controller: AccountPickerController = new AccountPickerController({
    accounts: accountsCtrl,
    keystore: new KeystoreController('default', storageCtrl, {}, uiCtrl),
    networks: networksCtrl,
    providers: providersCtrl,
    relayerUrl,
    fetch,
    externalSignerControllers: {},
    onAddAccountsSuccessCallback: () => Promise.resolve()
  })

  return {
    controller,
    storageCtrl
  }
}

describe('AccountPicker', () => {
  test('should initialize', async () => {
    const { controller } = await prepareTest()
    const keyIterator = new KeyIterator(process.env.SEED)
    const hdPathTemplate = BIP44_STANDARD_DERIVATION_TEMPLATE
    controller.setInitParams({ keyIterator, hdPathTemplate })
    await controller.init()
    expect(controller.page).toEqual(DEFAULT_PAGE)
    expect(controller.pageSize).toEqual(DEFAULT_PAGE_SIZE)
    expect(controller.isInitialized).toBeTruthy()
    expect(controller.selectedAccounts.length).toEqual(1)
    expect(controller.hdPathTemplate).toEqual(hdPathTemplate)
    expect(controller.shouldGetAccountsUsedOnNetworks).toBeFalsy()
    expect(controller.shouldSearchForLinkedAccounts).toBeFalsy()
  })

  describe('Negative tests', () => {
    suppressConsoleBeforeEach()
    test('should throw if AccountPicker controller method is requested, but the controller was not initialized beforehand', async () => {
      const { controller } = await prepareTest()
      const unsubscribe = controller.onError(() => {
        const notInitializedErrorsCount = controller.emittedErrors.filter(
          (e: any) =>
            e.error.message ===
            'accountPicker: requested a method of the AccountPicker controller, but the controller was not initialized'
        ).length

        if (notInitializedErrorsCount === 4) {
          expect(notInitializedErrorsCount).toEqual(4)
        }
      })

      await controller.setPage({ page: 1 })
      controller.selectAccount(basicAccount)
      controller.deselectAccount(basicAccount)
      await controller.addAccounts()

      await wait(500) // wait a bit for the errors to be emitted

      expect.assertions(1)

      unsubscribe()
    })

    test('should throw if AccountPicker controller gets initialized, but the keyIterator is missing', async () => {
      const { controller } = await prepareTest()
      const unsubscribe = controller.onError((e) => {
        const missingKeyIteratorError = e.error.message === 'accountPicker: missing keyIterator'

        if (missingKeyIteratorError) {
          expect(missingKeyIteratorError).toBeTruthy()
          unsubscribe()
        }
      })

      controller.setInitParams({
        keyIterator: null,
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
      })
      await controller.init()
      await wait(500) // wait a bit for the error to be emitted
      expect.assertions(1)
    })
  })

  test('should retrieve 5 basic and one smart account on each page', async () => {
    const { controller } = await prepareTest()
    const PAGE_SIZE = 5
    const keyIterator = new KeyIterator(process.env.SEED)
    controller.setInitParams({
      keyIterator,
      pageSize: PAGE_SIZE,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldGetAccountsUsedOnNetworks: false,
      shouldSearchForLinkedAccounts: false,
      shouldAddNextAccountAutomatically: false
    })
    await controller.init()
    await controller.setPage({ page: 1 })
    expect(controller.accountsOnPage).toHaveLength(6)
    expect(controller.accountsOnPage.filter((a) => isSmartAccount(a.account))).toHaveLength(1)
    expect(controller.accountsOnPage.filter((a) => !isSmartAccount(a.account))).toHaveLength(5)

    await controller.setPage({ page: 2 })
    expect(controller.accountsOnPage).toHaveLength(6)
    expect(controller.accountsOnPage.filter((a) => isSmartAccount(a.account))).toHaveLength(1)
    expect(controller.accountsOnPage.filter((a) => !isSmartAccount(a.account))).toHaveLength(5)
  })

  test('should find linked accounts', async () => {
    const { controller } = await prepareTest()
    const keyIterator = new KeyIterator(process.env.SEED)
    controller.setInitParams({
      keyIterator,
      pageSize: 3,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldGetAccountsUsedOnNetworks: false,
      shouldAddNextAccountAutomatically: false
    })
    await controller.init()
    await controller.setPage({ page: 1 })
    expect(controller.linkedAccountsLoading).toBe(false)
    expect(controller.linkedAccountsError).toBeFalsy()
    const linkedAccountsOnPage = controller.accountsOnPage.filter(({ isLinked }) => isLinked)

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
    const { controller } = await prepareTest()
    const keyIterator = new KeyIterator(process.env.SEED)
    controller.setInitParams({
      keyIterator,
      pageSize: 1,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldSearchForLinkedAccounts: false,
      shouldGetAccountsUsedOnNetworks: false,
      shouldAddNextAccountAutomatically: false
    })
    await controller.init()
    await controller.setPage({ page: 1 })

    controller.selectAccount(basicAccount)
    const selectedAccountAddr = controller.selectedAccounts.map((a) => a.account.addr)
    expect(selectedAccountAddr).toContain(basicAccount.addr)

    controller.deselectAccount(basicAccount)
    expect(controller.selectedAccounts).toHaveLength(0)
  })

  test('should NOT be able to select the same account more than once', async () => {
    const { controller } = await prepareTest()
    const keyIterator = new KeyIterator(process.env.SEED)
    controller.setInitParams({
      keyIterator,
      pageSize: 1,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldSearchForLinkedAccounts: false,
      shouldGetAccountsUsedOnNetworks: false,
      shouldAddNextAccountAutomatically: false
    })
    await controller.init()
    await controller.setPage({ page: 1 })

    controller.selectAccount(basicAccount)
    controller.selectAccount(basicAccount)
    controller.selectAccount(basicAccount)

    expect(controller.selectedAccounts).toHaveLength(1)
    const selectedAccountAddr = controller.selectedAccounts.map((a) => a.account.addr)
    expect(selectedAccountAddr).toContain(basicAccount.addr)
  })

  test('should be able to select all the keys of a selected EOA (always one key)', async () => {
    const { controller } = await prepareTest()
    const keyIterator = new KeyIterator(process.env.SEED)
    controller.setInitParams({
      keyIterator,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldSearchForLinkedAccounts: false,
      shouldGetAccountsUsedOnNetworks: false,
      shouldAddNextAccountAutomatically: false
    })
    await controller.init()
    await controller.setPage({ page: 1 })

    controller.selectAccount(basicAccount)

    expect(controller.selectedAccounts[0]!.accountKeys).toHaveLength(1)
    const keyAddr = controller.selectedAccounts[0]!.accountKeys[0]!.addr
    const keyIndex = controller.selectedAccounts[0]!.accountKeys[0]!.index
    expect(keyAddr).toEqual(basicAccount.addr)
    expect(keyIndex).toEqual(0)
  })

  test('should be able to select all the keys of a selected smart account (derived key)', async () => {
    const { controller } = await prepareTest()
    const keyIterator = new KeyIterator(process.env.SEED)
    controller.setInitParams({
      keyIterator,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldSearchForLinkedAccounts: false,
      shouldGetAccountsUsedOnNetworks: false,
      shouldAddNextAccountAutomatically: false
    })
    await controller.init()
    await controller.setPage({ page: 1 })

    const smartAccount = controller.accountsOnPage.find((x) => isSmartAccount(x.account))
    if (smartAccount) controller.selectAccount(smartAccount.account)

    expect(controller.selectedAccounts[0]!.accountKeys)
      // Might contain other keys too, but this one should be in there,
      // since that's the derived used only for smart account key
      .toContainEqual({
        addr: key1to11BasicAccUsedForSmartAccKeysOnlyPublicAddresses[0],
        index: SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET,
        slot: 1
      })
  })

  DERIVATION_OPTIONS.forEach(({ label, value }) => {
    test(`should derive correctly ${label}`, async () => {
      const { controller } = await prepareTest()
      const keyIterator = new KeyIterator(process.env.SEED)
      const pageSize = 5
      controller.setInitParams({
        keyIterator,
        hdPathTemplate: value,
        pageSize,
        shouldSearchForLinkedAccounts: false,
        shouldGetAccountsUsedOnNetworks: false,
        shouldAddNextAccountAutomatically: false
      })
      await controller.init()

      // Checks page 1 EOAs
      await controller.setPage({ page: 1 })
      const basicAccountsOnFirstPage = controller.accountsOnPage.filter(
        (x) => !isSmartAccount(x.account)
      )
      const key1to5BasicAccPublicAddresses = Array.from(
        { length: pageSize },
        (_, i) => new Wallet(getPrivateKeyFromSeed(process.env.SEED, null, i, value)).address
      )
      basicAccountsOnFirstPage.forEach((x) => {
        const address = x.account.addr
        expect(address).toBe(key1to5BasicAccPublicAddresses[x.index])
      })

      // Checks page 2 EOAs
      await controller.setPage({ page: 2 })
      const basicAccountsOnSecondPage = controller.accountsOnPage.filter(
        (x) => !isSmartAccount(x.account)
      )
      const key6to10BasicAccPublicAddresses = Array.from(
        { length: pageSize },
        (_, i) =>
          new Wallet(getPrivateKeyFromSeed(process.env.SEED, null, i + pageSize, value)).address
      )
      basicAccountsOnSecondPage.forEach((x) => {
        const address = x.account.addr
        expect(address).toBe(key6to10BasicAccPublicAddresses[x.index - pageSize])
      })
    })
  })
})
