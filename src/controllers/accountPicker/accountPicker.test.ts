import { toBeHex, Wallet } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { suppressConsole, suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { makeMainController } from '../../../test/helpers/mainController'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import {
  BIP44_STANDARD_DERIVATION_TEMPLATE,
  DERIVATION_OPTIONS,
  SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
} from '../../consts/derivation'
import { Account } from '../../interfaces/account'
import { isSmartAccount } from '../../libs/account/account'
import { getPrivateKeyFromSeed, KeyIterator } from '../../libs/keyIterator/keyIterator'
import wait from '../../utils/wait'
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from './accountPicker'

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
  const { mainCtrl } = await makeMainController()

  await mainCtrl.keystore.initialLoadPromise

  return {
    controller: mainCtrl.accountPicker
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

  test('should limit the pages only when the key iterator has a limited number of keys', async () => {
    const { controller } = await prepareTest()
    const hdPathTemplate = BIP44_STANDARD_DERIVATION_TEMPLATE

    controller.setInitParams({ keyIterator: new KeyIterator(process.env.SEED), hdPathTemplate })
    await controller.init()
    expect(controller.toJSON().maxPage).toBeUndefined()

    const privateKeys = Array.from({ length: 11 }, (_, i) =>
      getPrivateKeyFromSeed(process.env.SEED, null, i, hdPathTemplate)
    )
    // Without adding them automatically, which would load every key on a single page
    controller.setInitParams({
      keyIterator: new KeyIterator(privateKeys),
      hdPathTemplate,
      pageSize: 5,
      shouldAddNextAccountAutomatically: false
    })
    await controller.init()
    expect(controller.toJSON().maxPage).toBe(3)
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

  test('should update basic account usage while smart accounts are still loading', async () => {
    const { controller } = await prepareTest()
    const pageSize = 5
    const keyIterator = new KeyIterator(process.env.SEED)
    const retrieve = keyIterator.retrieve.bind(keyIterator)
    let resolveSmartAccountKeys: (keys: string[]) => void = () => {}
    const smartAccountKeysPromise = new Promise<string[]>((resolve) => {
      resolveSmartAccountKeys = resolve
    })

    jest.spyOn(keyIterator, 'retrieve').mockImplementation((indices, hdPathTemplate) => {
      if ((indices[0]?.from || 0) >= SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET) {
        return smartAccountKeysPromise
      }

      return retrieve(indices, hdPathTemplate)
    })

    controller.setInitParams({
      keyIterator,
      pageSize,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldGetAccountsUsedOnNetworks: false,
      shouldSearchForLinkedAccounts: false,
      shouldAddNextAccountAutomatically: false
    })
    await controller.init()

    const setPagePromise = controller.setPage({ page: 1 })

    while (!controller.smartAccountsLoading) await wait(0)
    await wait(0)

    expect(controller.accountsLoading).toBe(false)
    expect(controller.accountsOnPage).toHaveLength(pageSize)
    expect(controller.accountsOnPage.every((a) => !isSmartAccount(a.account))).toBe(true)
    expect(controller.accountsOnPage.every((a) => a.account.usedOnNetworks === null)).toBe(true)

    controller.selectAccount(controller.accountsOnPage[0]!.account)
    expect(controller.selectedAccounts).toHaveLength(1)

    resolveSmartAccountKeys(
      key1to11BasicAccUsedForSmartAccKeysOnlyPublicAddresses.slice(0, pageSize)
    )
    await setPagePromise

    expect(controller.smartAccountsLoading).toBe(false)
    expect(controller.accountsOnPage).toHaveLength(pageSize + 1)
    expect(controller.selectedAccounts).toHaveLength(1)
  })

  test('should keep basic accounts available when smart account retrieval fails', async () => {
    const { controller } = await prepareTest()
    const pageSize = 5
    const keyIterator = new KeyIterator(process.env.SEED)
    const retrieve = keyIterator.retrieve.bind(keyIterator)

    jest.spyOn(keyIterator, 'retrieve').mockImplementation((indices, hdPathTemplate) => {
      if ((indices[0]?.from || 0) >= SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET) {
        return Promise.reject(new Error('Smart account key retrieval failed'))
      }

      return retrieve(indices, hdPathTemplate)
    })

    controller.setInitParams({
      keyIterator,
      pageSize,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldGetAccountsUsedOnNetworks: false,
      shouldSearchForLinkedAccounts: false,
      shouldAddNextAccountAutomatically: false
    })
    await controller.init()
    const { restore } = suppressConsole()
    await controller.setPage({ page: 1 })
    restore()

    expect(controller.accountsLoading).toBe(false)
    expect(controller.smartAccountsLoading).toBe(false)
    expect(controller.accountsOnPage).toHaveLength(pageSize)
    expect(controller.pageError).toBeNull()
    expect(controller.emittedErrors.at(-1)?.level).toBe('minor')
    expect(controller.emittedErrors.at(-1)?.message).toBe(
      'We could not finish loading smart accounts. You can still import the accounts already shown.'
    )

    controller.selectAccount(controller.accountsOnPage[0]!.account)
    expect(controller.selectedAccounts).toHaveLength(1)
  })

  test('should ignore smart accounts retrieved after the account picker is reset', async () => {
    const { controller } = await prepareTest()
    const keyIterator = new KeyIterator(process.env.SEED)
    const retrieve = keyIterator.retrieve.bind(keyIterator)
    let resolveSmartAccountKeys: (keys: string[]) => void = () => {}
    const smartAccountKeysPromise = new Promise<string[]>((resolve) => {
      resolveSmartAccountKeys = resolve
    })

    jest.spyOn(keyIterator, 'retrieve').mockImplementation((indices, hdPathTemplate) => {
      if ((indices[0]?.from || 0) >= SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET) {
        return smartAccountKeysPromise
      }

      return retrieve(indices, hdPathTemplate)
    })

    controller.setInitParams({
      keyIterator,
      pageSize: 5,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldGetAccountsUsedOnNetworks: false,
      shouldSearchForLinkedAccounts: false,
      shouldAddNextAccountAutomatically: false
    })
    await controller.init()

    const setPagePromise = controller.setPage({ page: 1 })
    while (!controller.smartAccountsLoading) await wait(0)

    await controller.reset()
    resolveSmartAccountKeys(key1to11BasicAccUsedForSmartAccKeysOnlyPublicAddresses.slice(0, 5))
    await setPagePromise

    expect(controller.isInitialized).toBe(false)
    expect(controller.smartAccountsLoading).toBe(false)
    expect(controller.accountsOnPage).toHaveLength(0)
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

    // These accounts were manually added as signers to our test accounts
    expect(accountsOnSlot3).toContain('0x0ace96748e66F42EBeA22D777C2a99eA2c83D8A6')
    expect(accountsOnSlot3).toContain('0xc583f33d502dE560dd2C60D4103043d5998A98E5')
    expect(accountsOnSlot3).toContain('0xbEC6dB2638b29ffEf42df2B5B76B531d420FF18E')
    expect(accountsOnSlot3).toContain('0x997dF27B04C89796254e61B71c112250dE87a803')
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

  describe('private keys', () => {
    const PAGE_SIZE = 5
    const bulkPrivateKeys = Array.from({ length: 7 }, (_, i) => toBeHex(i + 1, 32))
    const bulkAddresses = bulkPrivateKeys.map((privateKey) => new Wallet(privateKey).address)

    const toImportedBasicAccount = (addr: string): Account => ({
      ...basicAccount,
      addr,
      associatedKeys: [addr],
      initialPrivileges: [[addr, basicAccount.initialPrivileges[0]![1]]],
      preferences: { label: DEFAULT_ACCOUNT_LABEL, pfp: addr }
    })

    /**
     * Makes a main controller with an unlocked keystore, in which the given private keys
     * (and their accounts) are already imported.
     */
    const prepareTestWithImportedPrivateKeys = async (importedPrivateKeys: string[]) => {
      const importedAddresses = importedPrivateKeys.map((key) => new Wallet(key).address)
      const { mainCtrl } = await makeMainController(async (storageCtrl) => {
        await storageCtrl.set('accounts', importedAddresses.map(toImportedBasicAccount))
      })
      await mainCtrl.initialLoadPromise
      await mainCtrl.keystore.addSecret('password', '12345678', '', true)
      await mainCtrl.keystore.addKeys(
        importedPrivateKeys.map((privateKey, i) => ({
          addr: importedAddresses[i]!,
          type: 'internal' as const,
          label: `Key ${i + 1}`,
          privateKey,
          dedicatedToOneSA: false,
          meta: { createdAt: Date.now() }
        }))
      )

      return { mainCtrl, controller: mainCtrl.accountPicker }
    }

    const initWithPrivateKeys = async (
      controller: Awaited<ReturnType<typeof prepareTest>>['controller'],
      privateKeys: string | string[],
      { pageSize, shouldAddNextAccountAutomatically = false } = {} as {
        pageSize?: number
        shouldAddNextAccountAutomatically?: boolean
      }
    ) => {
      controller.setInitParams({
        keyIterator: new KeyIterator(privateKeys),
        pageSize,
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
        shouldGetAccountsUsedOnNetworks: false,
        shouldSearchForLinkedAccounts: false,
        shouldAddNextAccountAutomatically
      })
      await controller.init()
    }

    test('should list every private key in order, with paging', async () => {
      const { controller } = await prepareTest()
      await initWithPrivateKeys(controller, bulkPrivateKeys, { pageSize: PAGE_SIZE })

      await controller.setPage({ page: 1 })
      expect(controller.accountsOnPage.map((a) => a.account.addr)).toEqual(
        bulkAddresses.slice(0, PAGE_SIZE)
      )
      expect(controller.accountsOnPage.map((a) => a.index)).toEqual([0, 1, 2, 3, 4])
      expect(controller.accountsOnPage.some((a) => isSmartAccount(a.account))).toBe(false)

      await controller.setPage({ page: 2 })
      expect(controller.accountsOnPage.map((a) => a.account.addr)).toEqual(
        bulkAddresses.slice(PAGE_SIZE)
      )
      expect(controller.accountsOnPage.map((a) => a.index)).toEqual([5, 6])

      await controller.setPage({ page: 3 })
      expect(controller.accountsOnPage).toEqual([])
    })

    test('should automatically import every private key from the list', async () => {
      const { mainCtrl, controller } = await prepareTestWithImportedPrivateKeys([])

      await initWithPrivateKeys(controller, bulkPrivateKeys, {
        shouldAddNextAccountAutomatically: true
      })

      const importedAddresses = mainCtrl.accounts.accounts.map((a) => a.addr)
      expect(importedAddresses).toEqual(expect.arrayContaining(bulkAddresses))
      expect(controller.addedAccountsFromCurrentSession.map((a) => a.addr)).toEqual(bulkAddresses)
      const keystoreAddresses = mainCtrl.keystore.keys.map((k) => k.addr)
      expect(keystoreAddresses).toEqual(expect.arrayContaining(bulkAddresses))
    })

    test('should automatically import only the private keys that are not imported yet', async () => {
      const alreadyImportedPrivateKeys = bulkPrivateKeys.slice(0, 2)
      const { controller } = await prepareTestWithImportedPrivateKeys(alreadyImportedPrivateKeys)

      await initWithPrivateKeys(controller, bulkPrivateKeys.slice(0, 4), {
        shouldAddNextAccountAutomatically: true
      })

      expect(controller.addedAccountsFromCurrentSession.map((a) => a.addr)).toEqual(
        bulkAddresses.slice(2, 4)
      )
    })

    test('should automatically import a single private key, as before', async () => {
      const { controller } = await prepareTestWithImportedPrivateKeys([])

      await initWithPrivateKeys(controller, bulkPrivateKeys[0]!, {
        shouldAddNextAccountAutomatically: true
      })

      expect(controller.addedAccountsFromCurrentSession.map((a) => a.addr)).toEqual([
        bulkAddresses[0]
      ])
    })

    test('should stop looking for the next account after the last private key when all are imported', async () => {
      const privateKeys = bulkPrivateKeys.slice(0, 3)
      const { controller } = await prepareTestWithImportedPrivateKeys(privateKeys)
      await initWithPrivateKeys(controller, privateKeys, { pageSize: PAGE_SIZE })
      const setPageSpy = jest.spyOn(controller, 'setPage')
      const emittedErrors: string[] = []
      const unsubscribe = controller.onError((e) => emittedErrors.push(e.error.message))

      await controller.selectNextAccount()

      unsubscribe()
      // The first page holds all the keys, the second one is empty
      expect(setPageSpy).toHaveBeenCalledTimes(2)
      expect(controller.selectedAccounts).toEqual([])
      expect(emittedErrors).toEqual([])
      setPageSpy.mockRestore()
    })
  })

  test.each(DERIVATION_OPTIONS)('should derive correctly $label', async ({ value }) => {
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
