import { toBeHex, Wallet } from 'ethers'

import { Session } from '@/classes/session'
import { DEFAULT_ACCOUNT_LABEL } from '@/consts/account'
import {
  LEGACY_POPULAR_DERIVATION_TEMPLATE,
  BIP44_STANDARD_DERIVATION_TEMPLATE
} from '@/consts/derivation'
import { AccountOnchainState } from '@/interfaces/account'
import { ErrorRef } from '@/interfaces/eventEmitter'
import { DappConnectRequest, PlainTextMessageUserRequest } from '@/interfaces/userRequest'
import { AccountOpStatus } from '@/libs/accountOp/types'
import { isSmartAccount } from '@/libs/account/account'
import { KeyIterator, MAX_BULK_PRIVATE_KEYS } from '@/libs/keyIterator/keyIterator'
import * as keystoreLib from '@/libs/keystore/keystore'
import { stringify } from '@/libs/richJson/richJson'
import wait from '@/utils/wait'
import { describe, expect, jest, test } from '@jest/globals'
import { makeMainController } from '@test/helpers/mainController'

import { MainController } from './main'

describe('Main Controller ', () => {
  const accounts = [
    {
      addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
      associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
      },
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: '0xa07D75aacEFd11b425AF7181958F0F85c312f143'
      }
    },
    {
      addr: '0x6C0937c7a04487573673a47F22E4Af9e96b91ecd',
      associatedKeys: ['0xfF3f6D14DF43c112aB98834Ee1F82083E07c26BF'],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f1e7646e4695bead8bb0596679b0caf3a7ff6c4e04d2ad79103c8fa61fb6337f47fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
      },
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: '0x6C0937c7a04487573673a47F22E4Af9e96b91ecd'
      }
    },
    {
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      associatedKeys: [],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
      },
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
      }
    }
  ]

  let controller: MainController
  beforeAll(async () => {
    const { mainCtrl } = await makeMainController(async (storageCtrl) => {
      await storageCtrl.set('accounts', accounts)
    })
    controller = mainCtrl
  })

  // @TODO: We should pass `autoConfirmMagicLink` to emailVault controller initialization
  // test('login with emailVault', async () => {
  //   // eslint-disable-next-line no-promise-executor-return
  //   const promise = new Promise((resolve) => controller.emailVault.onUpdate(() => resolve(null)))
  //   await controller.emailVault.getEmailVaultInfo(email)
  //   await promise
  //
  //   expect(controller.emailVault.emailVaultStates).toMatchObject({
  //     email: {
  //       [email]: {
  //         email,
  //         recoveryKey: expect.anything(),
  //         availableSecrets: expect.anything(),
  //         availableAccounts: {},
  //         operations: []
  //       }
  //     }
  //   })
  // })

  test('backup keyStore secret emailVault', async () => {
    void controller.emailVault?.uploadKeyStoreSecret('unufri@ambire.com')

    await new Promise((resolve) => {
      if (controller.emailVault) {
        const unsubscribe = controller.emailVault.onUpdate(() => {
          unsubscribe()
          resolve(null)
        })
      } else {
        resolve(null)
      }
    })
    // Assert the emailVault sub-controller is present and its status was updated
    expect(controller.emailVault).not.toBeNull()
    expect(controller.emailVault?.statuses).toBeDefined()
  })

  test('refreshes Safe transactions once while a manual refresh is in progress', async () => {
    let finishRefresh: (() => void) | undefined
    let markRefreshAsStarted: (() => void) | undefined
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshAsStarted = resolve
    })
    const fetchSafeTxnsSpy = jest.spyOn(controller, 'fetchSafeTxns').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
          markRefreshAsStarted?.()
        })
    )

    const firstRefresh = controller.refreshSafeTxns()
    await refreshStarted
    const secondRefresh = controller.refreshSafeTxns()

    expect(controller.statuses.refreshSafeTxns).toBe('LOADING')
    expect(fetchSafeTxnsSpy).toHaveBeenCalledTimes(1)
    expect(fetchSafeTxnsSpy).toHaveBeenCalledWith([], true)

    if (!finishRefresh) throw new Error('Safe transaction refresh did not start')
    finishRefresh()
    await Promise.all([firstRefresh, secondRefresh])

    expect(controller.statuses.refreshSafeTxns).toBe('INITIAL')
    fetchSafeTxnsSpy.mockRestore()
  })

  test('fetches the other Safes pending counts after the selected Safe on focus, only when unlocked', async () => {
    const fetchSafeTxnsSpy = jest.spyOn(controller, 'fetchSafeTxns').mockResolvedValue()
    const updateOtherSafesSpy = jest
      .spyOn(controller.safe, 'updateOtherSafesPendingCounts')
      .mockResolvedValue()
    const isUnlockedSpy = jest.spyOn(controller.keystore, 'isUnlocked', 'get')
    const view = { id: 'focus-test-view', type: 'popup' } as any

    try {
      isUnlockedSpy.mockReturnValue(false)
      controller.ui.uiEvent.emit('viewFocus', view)
      await wait(0)

      expect(fetchSafeTxnsSpy).toHaveBeenCalledWith([])
      expect(updateOtherSafesSpy).not.toHaveBeenCalled()

      isUnlockedSpy.mockReturnValue(true)
      controller.ui.uiEvent.emit('viewFocus', view)
      await wait(0)

      expect(updateOtherSafesSpy).toHaveBeenCalledTimes(1)
      expect(updateOtherSafesSpy).toHaveBeenCalledWith(controller.selectedAccount.account?.addr)
    } finally {
      fetchSafeTxnsSpy.mockRestore()
      updateOtherSafesSpy.mockRestore()
      isUnlockedSpy.mockRestore()
    }
  })

  test('refreshes the selected account when the mobile app gets focus, but not for a popup', async () => {
    if (!controller.selectedAccount.account)
      await controller.selectedAccount.select({ account: controller.accounts.accounts[0]! })
    jest.spyOn(controller, 'fetchSafeTxns').mockResolvedValue()
    const updateAccountStateSpy = jest
      .spyOn(controller.accounts, 'updateAccountState')
      .mockResolvedValue(undefined)

    try {
      controller.ui.uiEvent.emit('viewFocus', { id: 'focus-popup', type: 'popup' } as any)
      await wait(0)
      expect(updateAccountStateSpy).not.toHaveBeenCalled()

      controller.ui.uiEvent.emit('viewFocus', { id: 'focus-mobile', type: 'mobile' } as any)
      await wait(0)
      expect(updateAccountStateSpy).toHaveBeenCalledWith(controller.selectedAccount.account!.addr)
    } finally {
      jest.restoreAllMocks()
    }
  })

  test('fetches the other Safes pending counts when a view is added, only when unlocked', async () => {
    const fetchSafeTxnsSpy = jest.spyOn(controller, 'fetchSafeTxns').mockResolvedValue()
    const updateOtherSafesSpy = jest
      .spyOn(controller.safe, 'updateOtherSafesPendingCounts')
      .mockResolvedValue()
    const isUnlockedSpy = jest.spyOn(controller.keystore, 'isUnlocked', 'get')
    // Not an overlay view, so that the popup open flow stays out of the test
    const view = { id: 'add-view-test-view', type: 'tab' } as any

    try {
      isUnlockedSpy.mockReturnValue(false)
      controller.ui.uiEvent.emit('addView', view)
      await wait(0)

      expect(fetchSafeTxnsSpy).not.toHaveBeenCalled()
      expect(updateOtherSafesSpy).not.toHaveBeenCalled()

      isUnlockedSpy.mockReturnValue(true)
      controller.ui.uiEvent.emit('addView', view)
      await wait(0)

      expect(fetchSafeTxnsSpy).toHaveBeenCalledWith([])
      expect(updateOtherSafesSpy).toHaveBeenCalledWith(controller.selectedAccount.account?.addr)
    } finally {
      fetchSafeTxnsSpy.mockRestore()
      updateOtherSafesSpy.mockRestore()
      isUnlockedSpy.mockRestore()
    }
  })

  test('fetches the other Safes pending counts when the wallet gets unlocked', async () => {
    const fetchSafeTxnsSpy = jest.spyOn(controller, 'fetchSafeTxns').mockResolvedValue()
    const updateOtherSafesSpy = jest
      .spyOn(controller.safe, 'updateOtherSafesPendingCounts')
      .mockResolvedValue()
    const migrationSpy = jest
      .spyOn(controller.storage, 'associateAccountKeysWithLegacySavedSeedMigration')
      .mockResolvedValue()
    const isUnlockedSpy = jest.spyOn(controller.keystore, 'isUnlocked', 'get')
    const originalUnlockStatus = controller.keystore.statuses.unlockWithSecret

    try {
      isUnlockedSpy.mockReturnValue(true)
      // An update that is not an unlock fetches nothing
      await controller.keystore.forceEmitUpdate()
      await wait(0)
      expect(updateOtherSafesSpy).not.toHaveBeenCalled()

      controller.keystore.statuses.unlockWithSecret = 'SUCCESS'
      await controller.keystore.forceEmitUpdate()
      await wait(0)

      expect(fetchSafeTxnsSpy).toHaveBeenCalledWith([])
      expect(updateOtherSafesSpy).toHaveBeenCalledWith(controller.selectedAccount.account?.addr)
    } finally {
      controller.keystore.statuses.unlockWithSecret = originalUnlockStatus
      fetchSafeTxnsSpy.mockRestore()
      updateOtherSafesSpy.mockRestore()
      migrationSpy.mockRestore()
      isUnlockedSpy.mockRestore()
    }
  })

  test('tracks the Safe pending transaction API fetch while it is in progress', async () => {
    const originalSelectedAccount = controller.selectedAccount.account
    const account = controller.accounts.accounts[0]
    if (!account) throw new Error('Expected an account')

    controller.selectedAccount.account = {
      ...account,
      creation: null,
      safeCreation: {
        factoryAddr: '0x1',
        singleton: '0x1',
        saltNonce: '0x00',
        setupData: '0x'
      }
    }

    const accountState: AccountOnchainState = {
      accountAddr: account.addr,
      isDeployed: true,
      eoaNonce: null,
      nonce: 0n,
      erc4337Nonce: 0n,
      associatedKeys: account.associatedKeys,
      importedAccountKeys: [],
      balance: 0n,
      isEOA: false,
      isErc4337Enabled: false,
      isErc4337Nonce: false,
      isV2: false,
      currentBlock: 0n,
      isSmarterEoa: false,
      delegatedContract: null,
      delegatedContractName: null,
      threshold: 2,
      safeVersion: '1.4.1',
      updatedAt: 0
    }
    const getAccountStatesSpy = jest
      .spyOn(controller.accounts, 'getOrFetchAccountStates')
      .mockResolvedValue({ '1': accountState })
    let finishFetch: (() => void) | undefined
    let markFetchAsStarted: (() => void) | undefined
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchAsStarted = resolve
    })
    const fetchPendingSpy = jest.spyOn(controller.safe, 'fetchPending').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishFetch = () => resolve({})
          markFetchAsStarted?.()
        })
    )

    try {
      const fetchPromise = controller.fetchSafeTxns([1n])
      await fetchStarted

      expect(controller.statuses.fetchSafeTxns).toBe('LOADING')

      if (!finishFetch) throw new Error('Safe transaction fetch did not start')
      finishFetch()
      await fetchPromise

      expect(controller.statuses.fetchSafeTxns).toBe('INITIAL')
    } finally {
      controller.selectedAccount.account = originalSelectedAccount
      getAccountStatesSpy.mockRestore()
      fetchPendingSpy.mockRestore()
    }
  })

  // @TODO - have to rewrite this test and it should be part of email vault tests.
  // test('unlock keyStore with recovery secret emailVault', async () => {
  //   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  //   async function wait(ms: number) {
  //     // eslint-disable-next-line no-promise-executor-return
  //     return new Promise((resolve) => setTimeout(() => resolve(null), ms))
  //   }
  //   // controller.lock()
  //   await controller.emailVault.recoverKeyStore(email)
  //   // console.log('isUnlock ==>', controller.isUnlock())
  //   // eslint-disable-next-line no-promise-executor-return
  //   // await new Promise((resolve) => controller.emailVault.onUpdate(() => resolve(null)))
  //   // await wait(10000)
  //   // console.log('isUnlock ==>', controller.isUnlock())
  // })

  test('should add an account from the account picker and persist it in accounts', async () => {
    const { mainCtrl: controller } = await makeMainController(async (storageCtrl) => {
      await storageCtrl.set('accounts', accounts)
    })

    await controller.initialLoadPromise

    await controller.keystore.addSecret('password', '12345678', '', true)
    const keyIterator = new KeyIterator(
      '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
    )
    controller.accountPicker.setInitParams({
      keyIterator,
      hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
      shouldSelectNextAccountAutomatically: false
    })

    await controller.accountPicker.init()
    await controller.accountPicker.setPage({ page: 1 })

    let retries2 = 0
    while (controller.accountPicker.accountsLoading && retries2 < 20) {
      await wait(100)
      retries2++
    }

    if (controller.accountPicker.accountsLoading) {
      console.error('Account picker failed to load accounts in time', controller.accountPicker)
      throw new Error('Account picker accounts loading timeout')
    }

    const accToSelect = controller.accountPicker.accountsOnPage[0]!.account
    controller.accountPicker.selectAccount(controller.accountPicker.accountsOnPage[0]!.account)
    controller.accountPicker.prepareSelectedAccounts()
    await controller.accountPicker.addPreparedAccounts()
    expect(controller.accounts.accounts.map((a) => a.addr)).toContain(accToSelect.addr)
  })

  describe('account picker: accounts are prepared, then added only on proceeding', () => {
    const prepareNewSeedFlow = async () => {
      const { mainCtrl } = await makeMainController(async (storageCtrl) => {
        await storageCtrl.set('accounts', accounts)
      })
      await mainCtrl.initialLoadPromise
      await mainCtrl.keystore.addSecret('password', '12345678', '', true)
      await mainCtrl.accountPickerSetInitParamsFromNewSeed({})

      const snapshot = () => ({
        accounts: mainCtrl.accounts.accounts.map((account) => account.addr),
        keys: mainCtrl.keystore.keys.map((key) => `${key.addr}:${key.type}`),
        seeds: mainCtrl.keystore.seeds.map((seed) => seed.id)
      })

      return { mainCtrl, picker: mainCtrl.accountPicker, snapshot }
    }

    test('init selects and prepares the next account, but writes nothing', async () => {
      const { mainCtrl, picker, snapshot } = await prepareNewSeedFlow()
      const before = snapshot()

      await picker.init()

      expect(picker.readyToAddAccounts).toHaveLength(1)
      expect(snapshot()).toEqual(before)
      expect(mainCtrl.keystore.hasKeystoreTempSeed).toBe(true)
    })

    test('adds the prepared account, its key and the new recovery phrase on proceeding', async () => {
      const { mainCtrl, picker, snapshot } = await prepareNewSeedFlow()
      const before = snapshot()
      await picker.init()
      const [prepared] = picker.readyToAddAccounts

      await picker.addPreparedAccounts([
        { addr: prepared!.addr, preferences: { ...prepared!.preferences, label: 'Savings' } }
      ])

      const after = snapshot()
      expect(after.accounts).toEqual([...before.accounts, prepared!.addr])
      expect(after.keys).toHaveLength(before.keys.length + 1)
      expect(after.seeds).toHaveLength(before.seeds.length + 1)
      expect(
        mainCtrl.accounts.accounts.find((a) => a.addr === prepared!.addr)?.preferences.label
      ).toBe('Savings')
      // The flow is done
      expect(picker.isInitialized).toBe(false)
      expect(picker.readyToAddAccounts).toHaveLength(0)
    })

    test('going back (reset) writes nothing and drops the generated recovery phrase', async () => {
      const { mainCtrl, picker, snapshot } = await prepareNewSeedFlow()
      const before = snapshot()
      await picker.init()

      await picker.reset()

      expect(snapshot()).toEqual(before)
      expect(picker.readyToAddAccounts).toHaveLength(0)
      expect(mainCtrl.keystore.hasKeystoreTempSeed).toBe(false)
    })

    test('adding more accounts prepares the whole selection again', async () => {
      const { picker, snapshot } = await prepareNewSeedFlow()
      const before = snapshot()
      await picker.init()

      // Back on the picker, a second account is selected and prepared
      await picker.setPage({ page: 1, pageSize: 5 })
      const secondAccount = picker.accountsOnPage.find(
        ({ account, isLinked }) =>
          !isLinked &&
          !isSmartAccount(account) &&
          !picker.readyToAddAccounts.some((prepared) => prepared.addr === account.addr)
      )!.account
      picker.selectAccount(secondAccount)
      picker.prepareSelectedAccounts()
      expect(picker.readyToAddAccounts).toHaveLength(2)

      await picker.addPreparedAccounts()
      expect(snapshot().accounts).toHaveLength(before.accounts.length + 2)
    })

    test('adds the accounts prepared by a flow without keys (view-only)', async () => {
      const { mainCtrl, picker, snapshot } = await prepareNewSeedFlow()
      const before = snapshot()
      const viewOnlyAccount = {
        addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
        associatedKeys: [],
        initialPrivileges: [],
        creation: null,
        preferences: { label: 'Watched', pfp: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8' }
      }

      await picker.prepareAccounts({ accounts: [viewOnlyAccount] })
      expect(picker.readyToAddAccounts).toEqual([viewOnlyAccount])
      // The new recovery phrase of the abandoned flow went with the reset
      expect(mainCtrl.keystore.hasKeystoreTempSeed).toBe(false)
      expect(snapshot()).toEqual(before)

      await picker.addPreparedAccounts()
      expect(snapshot().accounts).toContain(viewOnlyAccount.addr)
      expect(snapshot().keys).toEqual(before.keys)
    })

    test('adds the key of the prepared account after another derivation path was browsed', async () => {
      const { mainCtrl, picker } = await prepareNewSeedFlow()
      await picker.init()
      const [prepared] = picker.readyToAddAccounts

      // "Add more" - the picker switches the derivation path, then the user goes back
      await picker.setHDPathTemplateAndPage({
        hdPathTemplate: LEGACY_POPULAR_DERIVATION_TEMPLATE,
        page: 2
      })
      picker.resetAccountsSelection()
      await picker.addPreparedAccounts()

      const keyAddrs = mainCtrl.keystore.keys.map((key) => key.addr)
      expect(prepared!.associatedKeys.some((addr) => keyAddrs.includes(addr))).toBe(true)
    })

    test('adds the key of the prepared account on its own path, even while the picker is on another', async () => {
      const { mainCtrl, picker, snapshot } = await prepareNewSeedFlow()
      const before = snapshot()
      await picker.init()
      const [prepared] = picker.readyToAddAccounts

      // Added while the picker still shows another derivation path (no going back first)
      await picker.setHDPathTemplateAndPage({
        hdPathTemplate: LEGACY_POPULAR_DERIVATION_TEMPLATE,
        page: 2
      })
      await picker.addPreparedAccounts()

      const keyAddrs = mainCtrl.keystore.keys.map((key) => key.addr)
      expect(prepared!.associatedKeys.some((addr) => keyAddrs.includes(addr))).toBe(true)
      const newSeed = mainCtrl.keystore.seeds.find(({ id }) => !before.seeds.includes(id))
      expect(newSeed?.hdPathTemplate).toBe(BIP44_STANDARD_DERIVATION_TEMPLATE)
    })

    test('a flow set up over an abandoned one prepares its own accounts', async () => {
      const { picker } = await prepareNewSeedFlow()
      await picker.init()
      const [abandoned] = picker.readyToAddAccounts
      // Going back was missed (no reset), then a recovery phrase is imported
      const keyIterator = new KeyIterator(process.env.SEED)
      await picker.setInitParams({
        keyIterator,
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
      })

      await picker.initIfNotStarted()

      expect(picker.keyIterator).toBe(keyIterator)
      expect(picker.readyToAddAccounts.map(({ addr }) => addr)).not.toContain(abandoned!.addr)
    })

    test('keeps a re-entered recovery phrase when its abandoned flow was not reset', async () => {
      const { mainCtrl, picker } = await prepareNewSeedFlow()
      await picker.reset()
      const enterPhrase = async () => {
        await mainCtrl.keystore.addTempSeed({
          seed: process.env.SEED!,
          seedPassphrase: null,
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
        })
        await picker.setInitParams({
          keyIterator: new KeyIterator(process.env.SEED),
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
        })
        await picker.initIfNotStarted()
      }

      await enterPhrase()
      await enterPhrase()

      expect(mainCtrl.keystore.hasKeystoreTempSeed).toBe(true)
    })

    test('never sends the private keys of the prepared accounts to the UI', async () => {
      const { picker } = await prepareNewSeedFlow()
      await picker.init()
      const privateKeys = picker
        .retrieveInternalKeysOfSelectedAccounts()
        .map((key) => key.privateKey)
      expect(privateKeys.length).toBeGreaterThan(0)

      // Every state the UI receives, while prepared and while being added
      const serializedStates = [stringify(picker.toJSON())]
      const unsubscribe = picker.onUpdate(() => serializedStates.push(stringify(picker.toJSON())))
      await picker.addPreparedAccounts()
      unsubscribe()

      serializedStates.forEach((serializedState) =>
        privateKeys.forEach((privateKey) => expect(serializedState).not.toContain(privateKey))
      )
    })
  })

  describe('accountPickerSetInitParamsFromNewSeed', () => {
    test('prepares the account picker with a new seed and replies to the UI request', async () => {
      const { mainCtrl } = await makeMainController()
      await mainCtrl.initialLoadPromise
      const sendUiMessage = jest.spyOn(mainCtrl.ui.message, 'sendUiMessage')

      await mainCtrl.accountPickerSetInitParamsFromNewSeed({}, 'request-1')

      expect(mainCtrl.accountPicker.initParams?.keyIterator?.subType).toBe('seed')
      expect(sendUiMessage).toHaveBeenCalledWith({ requestId: 'request-1', ok: true })
    })

    test('replies with an error when the call is refused', async () => {
      const { mainCtrl } = await makeMainController()
      await mainCtrl.initialLoadPromise
      const sendUiMessage = jest.spyOn(mainCtrl.ui.message, 'sendUiMessage')
      // A previous call that is still running makes `withStatus` refuse this one. The
      // statuses object is shared between instances, so it is restored for the next test.
      mainCtrl.statuses.accountPickerSetInitParamsFromNewSeed = 'LOADING'
      try {
        await mainCtrl.accountPickerSetInitParamsFromNewSeed({}, 'request-2')
      } finally {
        mainCtrl.statuses.accountPickerSetInitParamsFromNewSeed = 'INITIAL'
      }

      expect(mainCtrl.accountPicker.initParams).toBeNull()
      expect(sendUiMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'request-2', ok: false })
      )
    })

    test('does not reply without a request id', async () => {
      const { mainCtrl } = await makeMainController()
      await mainCtrl.initialLoadPromise
      const sendUiMessage = jest.spyOn(mainCtrl.ui.message, 'sendUiMessage')

      await mainCtrl.accountPickerSetInitParamsFromNewSeed({})

      expect(mainCtrl.accountPicker.initParams).not.toBeNull()
      expect(sendUiMessage).not.toHaveBeenCalled()
    })
  })

  describe('hardware wallet account picker set up', () => {
    // The key iterator is environment specific, the picker only keeps it
    class FakeTrezorKeyIterator {
      type = 'trezor'

      subType = 'hw'
    }

    test('sets the picker up and replies to the UI request', async () => {
      const { mainCtrl } = await makeMainController(undefined, {
        overrides: { externalSignerControllers: { trezor: { walletSDK: {} } as any } }
      })
      await mainCtrl.initialLoadPromise
      const sendUiMessage = jest.spyOn(mainCtrl.ui.message, 'sendUiMessage')

      await mainCtrl.handleAccountPickerInitTrezor(FakeTrezorKeyIterator, 'request-hw-1')

      expect(mainCtrl.accountPicker.initParams?.keyIterator).toBeInstanceOf(FakeTrezorKeyIterator)
      expect(sendUiMessage).toHaveBeenCalledWith({ requestId: 'request-hw-1', ok: true })
    })

    test('replies with an error when the wallet cannot be set up', async () => {
      // No Trezor signer in this environment, so setting it up throws
      const { mainCtrl } = await makeMainController()
      await mainCtrl.initialLoadPromise
      const sendUiMessage = jest.spyOn(mainCtrl.ui.message, 'sendUiMessage')

      await mainCtrl.handleAccountPickerInitTrezor(FakeTrezorKeyIterator, 'request-hw-2')

      expect(mainCtrl.accountPicker.initParams).toBeNull()
      expect(sendUiMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'request-hw-2', ok: false })
      )
      expect(mainCtrl.statuses.handleAccountPickerInitTrezor).toBe('INITIAL')
    })
  })

  test('should add accounts and merge the associated keys of the already added accounts', async () => {
    const privilege: [string, string] = [
      '0x699380c785819B2f400cb646b12C4C60b4dc7fcA',
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    ]
    const existingAccount = {
      addr: '0x0af4DF1eBE058F424F7995BbE02D50C5e74bf033',
      associatedKeys: ['0x699380c785819B2f400cb646b12C4C60b4dc7fcA'],
      initialPrivileges: [privilege],
      creation: accounts[0]!.creation,
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: '0x0af4DF1eBE058F424F7995BbE02D50C5e74bf033'
      }
    }

    const { mainCtrl } = await makeMainController(async (storageCtrl) => {
      await storageCtrl.set('accounts', [existingAccount])
    })
    await mainCtrl.initialLoadPromise

    await mainCtrl.accounts.addAccounts([
      {
        addr: '0x0af4DF1eBE058F424F7995BbE02D50C5e74bf033',
        associatedKeys: ['0xb1b2d032AA2F52347fbcfd08E5C3Cc55216E8404'],
        initialPrivileges: [privilege],
        creation: accounts[0]!.creation,
        preferences: {
          label: DEFAULT_ACCOUNT_LABEL,
          pfp: '0x0af4DF1eBE058F424F7995BbE02D50C5e74bf033'
        }
      }
    ])

    expect(mainCtrl.accounts.accounts[0]!.associatedKeys.length).toEqual(2)
    expect(mainCtrl.accounts.accounts[0]!.associatedKeys).toContain(
      '0x699380c785819B2f400cb646b12C4C60b4dc7fcA'
    )
    expect(mainCtrl.accounts.accounts[0]!.associatedKeys).toContain(
      '0xb1b2d032AA2F52347fbcfd08E5C3Cc55216E8404'
    )
  })

  describe('accountPickerSetInitParamsFromPrivateKeys', () => {
    const toPrivateKey = (n: number) => toBeHex(n, 32)
    const getAddresses = (privateKeys: string[]) =>
      privateKeys.map((privateKey) => new Wallet(privateKey).address)

    const setInitParamsFromPrivateKeys = async (privateKeys: string[]) => {
      const setInitParamsSpy = jest.spyOn(controller.accountPicker, 'setInitParams')
      const emittedErrors: ErrorRef[] = []
      const unsubscribe = controller.onError((error) => emittedErrors.push(error))

      await controller.accountPickerSetInitParamsFromPrivateKeys({ privateKeys })

      unsubscribe()
      const initParams = setInitParamsSpy.mock.calls[0]?.[0]
      setInitParamsSpy.mockRestore()
      await controller.accountPicker.setInitParams({
        keyIterator: null,
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
      })

      return { initParams, emittedErrors }
    }

    test('prepares the account picker with every private key in order', async () => {
      const privateKeys = [1, 2, 3].map(toPrivateKey)

      const { initParams, emittedErrors } = await setInitParamsFromPrivateKeys(privateKeys)

      expect(emittedErrors).toEqual([])
      expect(initParams?.hdPathTemplate).toBe(BIP44_STANDARD_DERIVATION_TEMPLATE)
      expect(initParams?.keyIterator?.subType).toBe('private-key')
      const addresses = await initParams?.keyIterator?.retrieve(
        [{ from: 0, to: 9 }],
        BIP44_STANDARD_DERIVATION_TEMPLATE
      )
      expect(addresses).toEqual(getAddresses(privateKeys))
      expect(controller.statuses.accountPickerSetInitParamsFromPrivateKeys).toBe('INITIAL')
    })

    test('drops duplicates that differ only by the 0x prefix, letter case or spaces', async () => {
      const privateKey = toPrivateKey(0xabc)
      const privateKeys = [
        privateKey,
        privateKey.slice(2),
        ` 0x${privateKey.slice(2).toUpperCase()} `,
        toPrivateKey(2)
      ]

      const { initParams, emittedErrors } = await setInitParamsFromPrivateKeys(privateKeys)

      expect(emittedErrors).toEqual([])
      const addresses = await initParams?.keyIterator?.retrieve(
        [{ from: 0, to: 9 }],
        BIP44_STANDARD_DERIVATION_TEMPLATE
      )
      expect(addresses).toEqual(getAddresses([privateKey, toPrivateKey(2)]))
    })

    test('accepts exactly the maximum number of private keys', async () => {
      const privateKeys = Array.from({ length: MAX_BULK_PRIVATE_KEYS }, (_, i) =>
        toPrivateKey(i + 1)
      )

      const { initParams, emittedErrors } = await setInitParamsFromPrivateKeys(privateKeys)

      expect(emittedErrors).toEqual([])
      expect(initParams?.keyIterator).toBeTruthy()
    })

    test('rejects more private keys than the maximum', async () => {
      const privateKeys = Array.from({ length: MAX_BULK_PRIVATE_KEYS + 1 }, (_, i) =>
        toPrivateKey(i + 1)
      )

      const { initParams, emittedErrors } = await setInitParamsFromPrivateKeys(privateKeys)

      expect(initParams).toBeUndefined()
      expect(emittedErrors).toHaveLength(1)
      expect(emittedErrors[0]!.message).toBe(
        `You can import up to ${MAX_BULK_PRIVATE_KEYS} private keys at once. Please remove some and try again.`
      )
      expect(emittedErrors[0]!.level).toBe('major')
    })

    test('rejects an empty list', async () => {
      const { initParams, emittedErrors } = await setInitParamsFromPrivateKeys([])

      expect(initParams).toBeUndefined()
      expect(emittedErrors.map((e) => e.message)).toEqual([
        'Please enter at least one private key.'
      ])
    })

    test('rejects the whole list if any private key is invalid, without exposing the keys', async () => {
      const validPrivateKey = toPrivateKey(1)
      const invalidPrivateKey = `${toPrivateKey(2).slice(0, -1)}z`

      const { initParams, emittedErrors } = await setInitParamsFromPrivateKeys([
        validPrivateKey,
        invalidPrivateKey
      ])

      expect(initParams).toBeUndefined()
      expect(emittedErrors).toHaveLength(1)
      expect(emittedErrors[0]!.message).toBe(
        'One or more of the private keys you entered is not valid. Please check them and try again.'
      )
      const reportedError = `${emittedErrors[0]!.message} ${emittedErrors[0]!.error?.message}`
      expect(reportedError).not.toContain(validPrivateKey.slice(2))
      expect(reportedError).not.toContain(invalidPrivateKey.slice(2))
    })

    test('rejects a recovery phrase passed as one of the private keys', async () => {
      const { initParams, emittedErrors } = await setInitParamsFromPrivateKeys([
        toPrivateKey(1),
        process.env.SEED!
      ])

      expect(initParams).toBeUndefined()
      expect(emittedErrors).toHaveLength(1)
      expect(emittedErrors[0]!.error?.message).not.toContain(process.env.SEED!)
    })
  })

  describe('accountPickerSetInitParamsFromSavedSeed', () => {
    const PASSPHRASE = 'extra word'

    const prepareSeedWithUnsavedPassphrase = async () => {
      const { mainCtrl } = await makeMainController()
      await mainCtrl.initialLoadPromise
      await mainCtrl.keystore.addSecret('password', 'password', '', false)
      await mainCtrl.keystore.unlockWithSecret('password', 'password')
      await mainCtrl.keystore.addTempSeed({
        seed: process.env.SEED!,
        seedPassphrase: PASSPHRASE,
        hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
      })
      await mainCtrl.keystore.persistTempSeed()

      return { mainCtrl, seedId: mainCtrl.keystore.seeds[0]!.id }
    }

    const setInitParamsFromSavedSeed = async (
      mainCtrl: MainController,
      params: { id: string; seedPassphrase?: string; shouldSavePassphrase?: boolean }
    ) => {
      const setInitParamsSpy = jest.spyOn(mainCtrl.accountPicker, 'setInitParams')
      const emittedErrors: ErrorRef[] = []
      const statuses: string[] = []
      const unsubscribeErrors = mainCtrl.onError((error) => emittedErrors.push(error))
      const unsubscribeUpdates = mainCtrl.onUpdate(() =>
        statuses.push(mainCtrl.statuses.accountPickerSetInitParamsFromSavedSeed)
      )

      await mainCtrl.accountPickerSetInitParamsFromSavedSeed(params)

      unsubscribeErrors()
      unsubscribeUpdates()
      const initParams = setInitParamsSpy.mock.calls[0]?.[0]
      setInitParamsSpy.mockRestore()

      return { initParams, emittedErrors, statuses }
    }

    test('prepares the account picker with the entered passphrase', async () => {
      const { mainCtrl, seedId } = await prepareSeedWithUnsavedPassphrase()

      const { initParams, emittedErrors, statuses } = await setInitParamsFromSavedSeed(mainCtrl, {
        id: seedId,
        seedPassphrase: PASSPHRASE
      })

      expect(emittedErrors).toEqual([])
      expect(statuses).toContain('SUCCESS')
      expect(initParams?.keyIterator?.subType).toBe('seed')
      expect(mainCtrl.statuses.accountPickerSetInitParamsFromSavedSeed).toBe('INITIAL')
    })

    test('reports a wrong passphrase to the user instead of throwing', async () => {
      const { mainCtrl, seedId } = await prepareSeedWithUnsavedPassphrase()

      const { initParams, emittedErrors, statuses } = await setInitParamsFromSavedSeed(mainCtrl, {
        id: seedId,
        seedPassphrase: 'another word'
      })

      expect(initParams).toBeUndefined()
      expect(emittedErrors).toEqual([
        expect.objectContaining({ message: 'Wrong passphrase.', level: 'expected' })
      ])
      expect(statuses).toContain('ERROR')
      expect(statuses).not.toContain('SUCCESS')
      expect(mainCtrl.statuses.accountPickerSetInitParamsFromSavedSeed).toBe('INITIAL')
    })

    test('replies to the request once set up, and with an error for a wrong passphrase', async () => {
      const { mainCtrl, seedId } = await prepareSeedWithUnsavedPassphrase()
      const sendUiMessage = jest.spyOn(mainCtrl.ui.message, 'sendUiMessage')

      await mainCtrl.accountPickerSetInitParamsFromSavedSeed(
        { id: seedId, seedPassphrase: 'another word' },
        'request-1'
      )
      await mainCtrl.accountPickerSetInitParamsFromSavedSeed(
        { id: seedId, seedPassphrase: PASSPHRASE },
        'request-2'
      )

      expect(sendUiMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'request-1', ok: false })
      )
      expect(sendUiMessage).toHaveBeenCalledWith({ requestId: 'request-2', ok: true })
      sendUiMessage.mockRestore()
    })

    test('checks the passphrase only once when saving it', async () => {
      const { mainCtrl, seedId } = await prepareSeedWithUnsavedPassphrase()
      const isSeedPassphraseCorrectSpy = jest.spyOn(mainCtrl.keystore, 'isSeedPassphraseCorrect')

      const { initParams, emittedErrors } = await setInitParamsFromSavedSeed(mainCtrl, {
        id: seedId,
        seedPassphrase: PASSPHRASE,
        shouldSavePassphrase: true
      })

      expect(isSeedPassphraseCorrectSpy).toHaveBeenCalledTimes(1)
      isSeedPassphraseCorrectSpy.mockRestore()
      expect(emittedErrors).toEqual([])
      expect(initParams?.keyIterator?.subType).toBe('seed')
      expect(mainCtrl.keystore.seeds[0]!.isPassphraseSaved).toBe(true)
    })

    test('does not derive from a passphrase the UI has just checked', async () => {
      const { mainCtrl, seedId } = await prepareSeedWithUnsavedPassphrase()
      await mainCtrl.keystore.isSeedPassphraseCorrectAndSendResToUi(seedId, PASSPHRASE, 'request')
      const getSeedMasterNodeSpy = jest.spyOn(keystoreLib, 'getSeedMasterNode')

      const { initParams, emittedErrors } = await setInitParamsFromSavedSeed(mainCtrl, {
        id: seedId,
        seedPassphrase: PASSPHRASE
      })

      expect(getSeedMasterNodeSpy).not.toHaveBeenCalled()
      getSeedMasterNodeSpy.mockRestore()
      expect(emittedErrors).toEqual([])
      expect(initParams?.keyIterator?.subType).toBe('seed')
    })

    test('neither saves a wrong passphrase nor opens the picker with it', async () => {
      const { mainCtrl, seedId } = await prepareSeedWithUnsavedPassphrase()

      const { initParams, emittedErrors } = await setInitParamsFromSavedSeed(mainCtrl, {
        id: seedId,
        seedPassphrase: 'another word',
        shouldSavePassphrase: true
      })

      expect(initParams).toBeUndefined()
      expect(emittedErrors).toEqual([
        expect.objectContaining({ message: 'Wrong passphrase.', level: 'expected' })
      ])
      expect(mainCtrl.keystore.seeds[0]!.isPassphraseSaved).toBe(false)
    })
  })

  describe('updateAccounts', () => {
    const getAccount = (addr: string) => ({
      addr,
      associatedKeys: [],
      initialPrivileges: [],
      creation: accounts[0]!.creation,
      preferences: { label: DEFAULT_ACCOUNT_LABEL, pfp: addr }
    })

    test('adds selected accounts and removes deselected imported accounts', async () => {
      const accountToKeep = getAccount('0x1111111111111111111111111111111111111111')
      const accountToRemove = getAccount('0x2222222222222222222222222222222222222222')
      const accountToAdd = getAccount('0x3333333333333333333333333333333333333333')
      const { mainCtrl } = await makeMainController(async (storageCtrl) => {
        await storageCtrl.set('accounts', [accountToKeep, accountToRemove])
      })
      await mainCtrl.initialLoadPromise

      await mainCtrl.updateAccounts({
        accountsToAdd: [accountToAdd],
        accountAddressesToRemove: [accountToRemove.addr]
      })

      expect(mainCtrl.accounts.accounts.map((account) => account.addr)).toEqual([
        accountToKeep.addr,
        accountToAdd.addr
      ])
    })

    test('ignores removal requests for accounts that are not imported', async () => {
      const importedAccount = getAccount('0x1111111111111111111111111111111111111111')
      const { mainCtrl } = await makeMainController(async (storageCtrl) => {
        await storageCtrl.set('accounts', [importedAccount])
      })
      await mainCtrl.initialLoadPromise

      await mainCtrl.updateAccounts({
        accountsToAdd: [],
        accountAddressesToRemove: ['0x2222222222222222222222222222222222222222']
      })

      expect(mainCtrl.accounts.accounts.map((account) => account.addr)).toEqual([
        importedAccount.addr
      ])
    })

    test('does not remove an account that is also being added', async () => {
      const importedAccount = getAccount('0x1111111111111111111111111111111111111111')
      const { mainCtrl } = await makeMainController(async (storageCtrl) => {
        await storageCtrl.set('accounts', [importedAccount])
      })
      await mainCtrl.initialLoadPromise

      await mainCtrl.updateAccounts({
        accountsToAdd: [importedAccount],
        accountAddressesToRemove: [importedAccount.addr]
      })

      expect(mainCtrl.accounts.accounts.map((account) => account.addr)).toEqual([
        importedAccount.addr
      ])
    })

    test('selects the first newly imported account when imported accounts come first', async () => {
      const importedAccount = getAccount('0x1111111111111111111111111111111111111111')
      const firstNewAccount = getAccount('0x2222222222222222222222222222222222222222')
      const secondNewAccount = getAccount('0x3333333333333333333333333333333333333333')
      const { mainCtrl } = await makeMainController(async (storageCtrl) => {
        await storageCtrl.set('accounts', [importedAccount])
        await storageCtrl.set('selectedAccount', importedAccount.addr)
      })
      await mainCtrl.initialLoadPromise

      await mainCtrl.updateAccounts({
        accountsToAdd: [importedAccount, firstNewAccount, secondNewAccount],
        accountAddressesToRemove: []
      })

      expect(mainCtrl.selectedAccount.account?.addr).toBe(firstNewAccount.addr)
    })
  })

  test('should check if network features get displayed correctly for ethereum', async () => {
    const eth = controller.networks.networks.find((n) => n.chainId === 1n)!
    expect(eth?.features.length).toBe(3)

    const saSupport = eth?.features.find((feat) => feat.id === 'saSupport')!
    expect(saSupport).not.toBe(null)
    expect(saSupport).not.toBe(undefined)
    expect(saSupport!.level).toBe('success')
    expect(saSupport!.title).toBe('Ambire Smart Accounts')

    const simulation = eth?.features.find((feat) => feat.id === 'simulation')
    expect(simulation).not.toBe(null)
    expect(simulation).not.toBe(undefined)
    expect(simulation!.level).toBe('success')

    const prices = eth?.features.find((feat) => feat.id === 'prices')
    expect(prices).not.toBe(null)
    expect(prices).not.toBe(undefined)
    expect(prices!.level).toBe('success')

    // set first to false so we could test setContractsDeployedToTrueIfDeployed
    await controller.networks.updateNetwork({ areContractsDeployed: false }, 1n)

    const eth2 = controller.networks.networks.find((n) => n.chainId === 1n)!
    expect(eth2.areContractsDeployed).toEqual(false)
    await controller.setContractsDeployedToTrueIfDeployed(eth2)

    const eth3 = controller.networks.networks.find((n) => n.chainId === 1n)!
    expect(eth3.areContractsDeployed).toEqual(true)
  })

  describe('updateAccountsOpsStatuses', () => {
    const senderAccount = accounts[0]!.addr
    const selectedAccountAddr = accounts[1]!.addr
    const recipientAccount = accounts[2]!.addr

    const flushAsyncUpdates = async () => {
      await wait(10)
    }

    const setupController = async () => {
      const { mainCtrl } = await makeMainController(async (storageCtrl) => {
        await storageCtrl.set('accounts', accounts)
      })

      // Avoid noisy side effects from this call while keeping the update flow realistic.
      jest
        .spyOn(mainCtrl.portfolio, 'reportMissedPortfolioUpdateAfterUpdatedAccountOp')
        .mockImplementation(() => {})

      jest
        .spyOn(mainCtrl.swapAndBridge, 'handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate')
        .mockImplementation(() => {})

      return mainCtrl
    }

    test('should fetch safe txns when shouldEmitUpdate is false and shouldFetchSafeTxns is true', async () => {
      const mainCtrl = await setupController()

      jest
        .spyOn(mainCtrl.activity, 'broadcastedButNotConfirmed', 'get')
        .mockReturnValue({ [senderAccount]: [{ id: 'pending-op', calls: [] } as any] })

      jest.spyOn(mainCtrl.activity, 'updateAccountsOpsStatuses').mockResolvedValue({
        [senderAccount]: {
          shouldEmitUpdate: false,
          chainsToUpdate: [1n],
          portfoliosToUpdate: { [recipientAccount]: [1n] },
          shouldFetchSafeTxns: true,
          newestOpTimestamp: Date.now(),
          updatedAccountsOps: [
            {
              id: '1',
              accountAddr: senderAccount,
              chainId: 1n,
              status: AccountOpStatus.Success,
              calls: []
            } as any
          ]
        }
      })

      const fetchSafeTxnsSpy = jest.spyOn(mainCtrl, 'fetchSafeTxns').mockResolvedValue(undefined)
      const updateAccountStateSpy = jest
        .spyOn(mainCtrl.accounts, 'updateAccountState')
        .mockResolvedValue(undefined)
      const discardSimulationSpy = jest
        .spyOn(mainCtrl.portfolio, 'discardSimulation')
        .mockResolvedValue(undefined)
      const updateSelectedAccountSpy = jest
        .spyOn(mainCtrl.portfolio, 'updateSelectedAccount')
        .mockResolvedValue(undefined)
      const scheduleUpdateSpy = jest
        .spyOn(mainCtrl.portfolio, 'scheduleUpdate')
        .mockImplementation(() => {})

      await mainCtrl.updateAccountsOpsStatuses()
      await flushAsyncUpdates()

      expect(fetchSafeTxnsSpy).toHaveBeenCalledTimes(1)
      expect(updateAccountStateSpy).not.toHaveBeenCalled()
      expect(discardSimulationSpy).not.toHaveBeenCalled()
      expect(updateSelectedAccountSpy).not.toHaveBeenCalled()
      expect(scheduleUpdateSpy).not.toHaveBeenCalled()
    })

    test('removes the safs of the Safe on the same chain when an internal deployment fails', async () => {
      const mainCtrl = await setupController()
      const rejectSafRequestsSpy = jest
        .spyOn(mainCtrl.requests, 'rejectSameChainNotSignedSafeRequest')
        .mockResolvedValue(undefined)

      jest
        .spyOn(mainCtrl.activity, 'broadcastedButNotConfirmed', 'get')
        .mockReturnValue({ [senderAccount]: [{ id: 'safe-deploy-op', calls: [] } as any] })
      jest.spyOn(mainCtrl.activity, 'updateAccountsOpsStatuses').mockResolvedValue({
        [senderAccount]: {
          shouldEmitUpdate: false,
          chainsToUpdate: [],
          portfoliosToUpdate: {},
          shouldFetchSafeTxns: false,
          newestOpTimestamp: Date.now(),
          updatedAccountsOps: [
            {
              id: 'safe-deploy-op',
              accountAddr: senderAccount,
              chainId: 1n,
              status: AccountOpStatus.Failure,
              calls: [],
              meta: { isSafeDeploy: true }
            } as any
          ]
        }
      })
      await mainCtrl.updateAccountsOpsStatuses()

      expect(rejectSafRequestsSpy).toHaveBeenCalledWith(
        senderAccount,
        1n,
        "Activating your Safe account failed, so this request can't be completed."
      )
    })

    test('should update account state for account address and discard finalized simulations', async () => {
      const mainCtrl = await setupController()

      const finalizedAccountOp = {
        id: 'finalized-op',
        accountAddr: senderAccount,
        chainId: 1n,
        status: AccountOpStatus.Success,
        calls: []
      } as any
      const pendingAccountOp = {
        id: 'pending-op',
        accountAddr: senderAccount,
        chainId: 1n,
        status: AccountOpStatus.Pending,
        calls: []
      } as any

      jest
        .spyOn(mainCtrl.activity, 'broadcastedButNotConfirmed', 'get')
        .mockReturnValue({ [senderAccount]: [pendingAccountOp] })

      jest.spyOn(mainCtrl.activity, 'updateAccountsOpsStatuses').mockResolvedValue({
        [senderAccount]: {
          shouldEmitUpdate: true,
          chainsToUpdate: [1n],
          portfoliosToUpdate: {},
          shouldFetchSafeTxns: false,
          newestOpTimestamp: Date.now(),
          updatedAccountsOps: [pendingAccountOp, finalizedAccountOp]
        }
      })

      const updateAccountStateSpy = jest
        .spyOn(mainCtrl.accounts, 'updateAccountState')
        .mockResolvedValue(undefined)
      const discardSimulationSpy = jest
        .spyOn(mainCtrl.portfolio, 'discardSimulation')
        .mockResolvedValue(undefined)
      const scheduleUpdateSpy = jest
        .spyOn(mainCtrl.portfolio, 'scheduleUpdate')
        .mockImplementation(() => {})

      await mainCtrl.updateAccountsOpsStatuses()
      await flushAsyncUpdates()

      expect(updateAccountStateSpy).toHaveBeenCalledWith(senderAccount, 'latest', [1n], true)
      expect(discardSimulationSpy).toHaveBeenCalledWith([finalizedAccountOp])
      // A cache-busting update is scheduled for the updated chain.
      expect(scheduleUpdateSpy).toHaveBeenCalledTimes(1)
      expect(scheduleUpdateSpy).toHaveBeenCalledWith({
        accountId: senderAccount,
        chainId: 1n,
        bypassServerSideCache: true
      })
    })

    // Ops finalized without a receipt: activity leaves chainsToUpdate empty for them.
    test.each([
      AccountOpStatus.UnknownButPastNonce,
      AccountOpStatus.Rejected,
      AccountOpStatus.BroadcastButStuck
    ])(
      'discards the simulation of an op finalized as %s even without chainsToUpdate',
      async (status) => {
        const mainCtrl = await setupController()

        const finalizedAccountOp = {
          id: 'finalized-without-receipt',
          accountAddr: senderAccount,
          chainId: 1n,
          status,
          calls: []
        } as any

        jest
          .spyOn(mainCtrl.activity, 'broadcastedButNotConfirmed', 'get')
          .mockReturnValue({ [senderAccount]: [finalizedAccountOp] })
        jest.spyOn(mainCtrl.activity, 'updateAccountsOpsStatuses').mockResolvedValue({
          [senderAccount]: {
            shouldEmitUpdate: true,
            chainsToUpdate: [],
            portfoliosToUpdate: {},
            shouldFetchSafeTxns: false,
            newestOpTimestamp: Date.now(),
            updatedAccountsOps: [finalizedAccountOp]
          }
        })
        jest.spyOn(mainCtrl.accounts, 'updateAccountState').mockResolvedValue(undefined)
        jest.spyOn(mainCtrl.portfolio, 'scheduleUpdate').mockImplementation(() => {})
        const discardSimulationSpy = jest
          .spyOn(mainCtrl.portfolio, 'discardSimulation')
          .mockResolvedValue(undefined)

        await mainCtrl.updateAccountsOpsStatuses()
        await flushAsyncUpdates()

        // Otherwise the pending simulation stays on the dashboard until the app restarts
        expect(discardSimulationSpy).toHaveBeenCalledWith([finalizedAccountOp])
      }
    )

    test('discards the simulation even when the updated chain is no longer among the networks', async () => {
      const mainCtrl = await setupController()

      const finalizedAccountOp = {
        id: 'finalized-on-removed-network',
        accountAddr: senderAccount,
        chainId: 999999n,
        status: AccountOpStatus.Success,
        calls: []
      } as any

      jest
        .spyOn(mainCtrl.activity, 'broadcastedButNotConfirmed', 'get')
        .mockReturnValue({ [senderAccount]: [finalizedAccountOp] })
      jest.spyOn(mainCtrl.activity, 'updateAccountsOpsStatuses').mockResolvedValue({
        [senderAccount]: {
          shouldEmitUpdate: true,
          chainsToUpdate: [999999n],
          portfoliosToUpdate: {},
          shouldFetchSafeTxns: false,
          newestOpTimestamp: Date.now(),
          updatedAccountsOps: [finalizedAccountOp]
        }
      })
      const updateAccountStateSpy = jest
        .spyOn(mainCtrl.accounts, 'updateAccountState')
        .mockResolvedValue(undefined)
      const discardSimulationSpy = jest
        .spyOn(mainCtrl.portfolio, 'discardSimulation')
        .mockResolvedValue(undefined)

      await mainCtrl.updateAccountsOpsStatuses()
      await flushAsyncUpdates()

      expect(updateAccountStateSpy).not.toHaveBeenCalled()
      expect(discardSimulationSpy).toHaveBeenCalledWith([finalizedAccountOp])
    })

    test('should call updateSelectedAccount for recipient accounts from portfoliosToUpdate', async () => {
      const mainCtrl = await setupController()

      const finalizedAccountOp = {
        id: 'finalized-op',
        accountAddr: senderAccount,
        chainId: 1n,
        status: AccountOpStatus.Success,
        calls: []
      } as any

      jest
        .spyOn(mainCtrl.activity, 'broadcastedButNotConfirmed', 'get')
        .mockReturnValue({ [senderAccount]: [{ id: 'pending-op', calls: [] } as any] })

      jest.spyOn(mainCtrl.activity, 'updateAccountsOpsStatuses').mockResolvedValue({
        [senderAccount]: {
          shouldEmitUpdate: true,
          chainsToUpdate: [1n],
          portfoliosToUpdate: {
            [recipientAccount]: [1n]
          },
          shouldFetchSafeTxns: false,
          newestOpTimestamp: Date.now(),
          updatedAccountsOps: [finalizedAccountOp]
        }
      })

      jest.spyOn(mainCtrl.accounts, 'updateAccountState').mockResolvedValue(undefined)
      jest.spyOn(mainCtrl.portfolio, 'discardSimulation').mockResolvedValue(undefined)
      const updateSelectedAccountSpy = jest
        .spyOn(mainCtrl.portfolio, 'updateSelectedAccount')
        .mockResolvedValue(undefined)

      await mainCtrl.updateAccountsOpsStatuses()
      await flushAsyncUpdates()

      expect(updateSelectedAccountSpy).toHaveBeenCalledWith(
        recipientAccount,
        expect.arrayContaining([expect.objectContaining({ chainId: 1n })])
      )
    })

    test('waits for the RPC to reach the confirmed block before the sender and the recipients are refreshed', async () => {
      const mainCtrl = await setupController()

      const confirmedAccountOp = {
        id: 'confirmed-op',
        accountAddr: senderAccount,
        chainId: 1n,
        status: AccountOpStatus.Success,
        blockNumber: 123,
        calls: []
      } as any

      jest
        .spyOn(mainCtrl.activity, 'broadcastedButNotConfirmed', 'get')
        .mockReturnValue({ [senderAccount]: [{ id: 'pending-op', calls: [] } as any] })
      jest.spyOn(mainCtrl.activity, 'updateAccountsOpsStatuses').mockResolvedValue({
        [senderAccount]: {
          shouldEmitUpdate: true,
          chainsToUpdate: [1n],
          portfoliosToUpdate: { [recipientAccount]: [1n] },
          shouldFetchSafeTxns: false,
          newestOpTimestamp: Date.now(),
          updatedAccountsOps: [confirmedAccountOp]
        }
      })
      // The RPC is one block behind, then fails once on a node of its load balancer
      const getBlockNumberSpy = jest
        .spyOn(mainCtrl.providers.providers['1']!, 'getBlockNumber')
        .mockResolvedValueOnce(122)
        .mockRejectedValueOnce(new Error('rpc node down'))
        .mockResolvedValue(123)
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const blockNumberReadsBeforeRefresh: number[] = []
      const updateAccountStateSpy = jest
        .spyOn(mainCtrl.accounts, 'updateAccountState')
        .mockImplementation(async () => {
          blockNumberReadsBeforeRefresh.push(getBlockNumberSpy.mock.calls.length)
        })
      jest.spyOn(mainCtrl.portfolio, 'scheduleUpdate').mockImplementation(() => {})
      const discardSimulationSpy = jest
        .spyOn(mainCtrl.portfolio, 'discardSimulation')
        .mockResolvedValue(undefined)
      const updateSelectedAccountSpy = jest
        .spyOn(mainCtrl.portfolio, 'updateSelectedAccount')
        .mockResolvedValue(undefined)

      try {
        await mainCtrl.updateAccountsOpsStatuses()
        // The reads are 250ms and then 500ms apart
        await wait(1000)
        await flushAsyncUpdates()

        expect(blockNumberReadsBeforeRefresh).toEqual([3, 3])
        expect(updateAccountStateSpy).toHaveBeenCalledWith(senderAccount, 'latest', [1n], true)
        expect(updateAccountStateSpy).toHaveBeenCalledWith(recipientAccount, 'latest', [1n], true)
        expect(discardSimulationSpy).toHaveBeenCalledWith([confirmedAccountOp])
        expect(updateSelectedAccountSpy).toHaveBeenCalledWith(
          recipientAccount,
          expect.arrayContaining([expect.objectContaining({ chainId: 1n })])
        )
      } finally {
        consoleErrorSpy.mockRestore()
      }
    })

    test('reports a failed refresh instead of leaving an unhandled rejection', async () => {
      const mainCtrl = await setupController()
      const confirmedAccountOp = {
        id: 'confirmed-op',
        accountAddr: senderAccount,
        chainId: 1n,
        status: AccountOpStatus.Success,
        blockNumber: 123,
        calls: []
      } as any
      jest
        .spyOn(mainCtrl.activity, 'broadcastedButNotConfirmed', 'get')
        .mockReturnValue({ [senderAccount]: [{ id: 'pending-op', calls: [] } as any] })
      jest.spyOn(mainCtrl.activity, 'updateAccountsOpsStatuses').mockResolvedValue({
        [senderAccount]: {
          shouldEmitUpdate: true,
          chainsToUpdate: [1n],
          portfoliosToUpdate: {},
          shouldFetchSafeTxns: false,
          newestOpTimestamp: Date.now(),
          updatedAccountsOps: [confirmedAccountOp]
        }
      })
      jest.spyOn(mainCtrl.providers.providers['1']!, 'getBlockNumber').mockResolvedValue(123)
      jest.spyOn(mainCtrl.accounts, 'updateAccountState').mockRejectedValue(new Error('rpc down'))
      const errors: string[] = []
      mainCtrl.onError((error) => errors.push(error.message))

      await mainCtrl.updateAccountsOpsStatuses()
      await flushAsyncUpdates()

      expect(
        errors.some((message) => message.includes('after its transactions were confirmed'))
      ).toBe(true)
    })

    test('should update account state and discard simulation even when selected account is different', async () => {
      const mainCtrl = await setupController()

      await mainCtrl.selectedAccount.select({ account: mainCtrl.accounts.accounts[1]! })

      const finalizedAccountOp = {
        id: 'finalized-op',
        // Different account than the selected one, but it should still update and discard simulations for it
        accountAddr: senderAccount,
        chainId: 1n,
        status: AccountOpStatus.Success,
        calls: []
      } as any

      jest
        .spyOn(mainCtrl.activity, 'broadcastedButNotConfirmed', 'get')
        .mockReturnValue({ [senderAccount]: [{ id: 'pending-op', calls: [] } as any] })

      jest.spyOn(mainCtrl.activity, 'updateAccountsOpsStatuses').mockResolvedValue({
        [senderAccount]: {
          shouldEmitUpdate: true,
          chainsToUpdate: [1n],
          portfoliosToUpdate: {},
          shouldFetchSafeTxns: false,
          newestOpTimestamp: Date.now(),
          updatedAccountsOps: [finalizedAccountOp]
        }
      })

      const updateAccountStateSpy = jest
        .spyOn(mainCtrl.accounts, 'updateAccountState')
        .mockResolvedValue(undefined)
      const discardSimulationSpy = jest
        .spyOn(mainCtrl.portfolio, 'discardSimulation')
        .mockResolvedValue(undefined)
      const scheduleUpdateSpy = jest
        .spyOn(mainCtrl.portfolio, 'scheduleUpdate')
        .mockImplementation(() => {})

      await mainCtrl.updateAccountsOpsStatuses()
      await flushAsyncUpdates()

      expect(mainCtrl.selectedAccount.account?.addr).toBe(selectedAccountAddr)
      expect(updateAccountStateSpy).toHaveBeenCalledWith(senderAccount, 'latest', [1n], true)
      expect(discardSimulationSpy).toHaveBeenCalledWith([finalizedAccountOp])
      // Scheduling targets the tx account, not the selected one.
      expect(scheduleUpdateSpy).toHaveBeenCalledWith({
        accountId: senderAccount,
        chainId: 1n,
        bypassServerSideCache: true
      })
    })

    test('schedules a cache-busting update for every chain in chainsToUpdate', async () => {
      const mainCtrl = await setupController()

      const finalizedAccountOp = {
        id: 'finalized-op',
        accountAddr: senderAccount,
        chainId: 1n,
        status: AccountOpStatus.Success,
        calls: []
      } as any

      jest
        .spyOn(mainCtrl.activity, 'broadcastedButNotConfirmed', 'get')
        .mockReturnValue({ [senderAccount]: [{ id: 'pending-op', calls: [] } as any] })

      jest.spyOn(mainCtrl.activity, 'updateAccountsOpsStatuses').mockResolvedValue({
        [senderAccount]: {
          shouldEmitUpdate: true,
          chainsToUpdate: [1n, 10n],
          portfoliosToUpdate: {},
          shouldFetchSafeTxns: false,
          newestOpTimestamp: Date.now(),
          updatedAccountsOps: [finalizedAccountOp]
        }
      })

      const updateAccountStateSpy = jest
        .spyOn(mainCtrl.accounts, 'updateAccountState')
        .mockResolvedValue(undefined)
      jest.spyOn(mainCtrl.portfolio, 'discardSimulation').mockResolvedValue(undefined)
      const scheduleUpdateSpy = jest
        .spyOn(mainCtrl.portfolio, 'scheduleUpdate')
        .mockImplementation(() => {})

      await mainCtrl.updateAccountsOpsStatuses()
      await flushAsyncUpdates()

      expect(updateAccountStateSpy).toHaveBeenCalledWith(senderAccount, 'latest', [1n, 10n], true)
      expect(scheduleUpdateSpy).toHaveBeenCalledTimes(2)
      expect(scheduleUpdateSpy).toHaveBeenCalledWith({
        accountId: senderAccount,
        chainId: 1n,
        bypassServerSideCache: true
      })
      expect(scheduleUpdateSpy).toHaveBeenCalledWith({
        accountId: senderAccount,
        chainId: 10n,
        bypassServerSideCache: true
      })
    })

    test('schedules the update before discarding the simulation', async () => {
      const mainCtrl = await setupController()

      const finalizedAccountOp = {
        id: 'finalized-op',
        accountAddr: senderAccount,
        chainId: 1n,
        status: AccountOpStatus.Success,
        calls: []
      } as any

      jest
        .spyOn(mainCtrl.activity, 'broadcastedButNotConfirmed', 'get')
        .mockReturnValue({ [senderAccount]: [{ id: 'pending-op', calls: [] } as any] })

      jest.spyOn(mainCtrl.activity, 'updateAccountsOpsStatuses').mockResolvedValue({
        [senderAccount]: {
          shouldEmitUpdate: true,
          chainsToUpdate: [1n],
          portfoliosToUpdate: {},
          shouldFetchSafeTxns: false,
          newestOpTimestamp: Date.now(),
          updatedAccountsOps: [finalizedAccountOp]
        }
      })

      jest.spyOn(mainCtrl.accounts, 'updateAccountState').mockResolvedValue(undefined)
      const scheduleUpdateSpy = jest
        .spyOn(mainCtrl.portfolio, 'scheduleUpdate')
        .mockImplementation(() => {})
      const discardSimulationSpy = jest
        .spyOn(mainCtrl.portfolio, 'discardSimulation')
        .mockResolvedValue(undefined)

      await mainCtrl.updateAccountsOpsStatuses()
      await flushAsyncUpdates()

      expect(scheduleUpdateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        discardSimulationSpy.mock.invocationCallOrder[0]!
      )
    })
  })

  describe('selectAccount while a request is open', () => {
    const session = new Session({ tabId: 1, url: 'https://test-dApp.com' })
    const [fromAccount, toAccount] = accounts

    const prepareSwitchTest = async () => {
      const { mainCtrl } = await makeMainController(async (storageCtrl) => {
        await storageCtrl.set(
          'accounts',
          accounts.map((acc) => ({
            ...acc,
            initialPrivileges: [],
            preferences: { label: '', pfp: '' }
          }))
        )
        await storageCtrl.set('selectedAccount', fromAccount!.addr)
      })
      return mainCtrl
    }

    const makeConnectRequest = (reject: (err: any) => void): DappConnectRequest => ({
      id: 'connect-request',
      kind: 'dappConnect',
      meta: {},
      dappPromises: [{ id: 'connect-request', resolve: () => {}, reject, session, meta: {} }]
    })

    const makeMessageRequest = (
      id: string,
      accountAddr: string,
      reject: (err: any) => void
    ): PlainTextMessageUserRequest => ({
      id,
      kind: 'message',
      meta: { params: { message: '0x48656c6c6f' }, accountAddr, chainId: 1n },
      dappPromises: [{ id, resolve: () => {}, reject, session, meta: {} }]
    })

    test('keeps the connect request open for the newly selected account', async () => {
      const mainCtrl = await prepareSwitchTest()
      const connectReject = jest.fn()
      await mainCtrl.requests.addUserRequests([makeConnectRequest(connectReject)])
      const windowId = mainCtrl.requests.requestWindow.windowProps?.id
      expect(windowId).toBeDefined()

      await mainCtrl.selectAccount(toAccount!.addr)

      expect(mainCtrl.selectedAccount.account?.addr).toBe(toAccount!.addr)
      expect(connectReject).not.toHaveBeenCalled()
      expect(mainCtrl.requests.currentUserRequest?.id).toBe('connect-request')
      expect(mainCtrl.requests.visibleUserRequests.map((r) => r.id)).toEqual(['connect-request'])
      expect(mainCtrl.requests.requestWindow.windowProps?.id).toBe(windowId)
    })

    test('still rejects a message request of the previous account', async () => {
      const mainCtrl = await prepareSwitchTest()
      const messageReject = jest.fn()
      await mainCtrl.requests.addUserRequests([
        makeMessageRequest('message-request', fromAccount!.addr, messageReject)
      ])
      expect(mainCtrl.requests.currentUserRequest?.id).toBe('message-request')

      await mainCtrl.selectAccount(toAccount!.addr)

      expect(messageReject).toHaveBeenCalledTimes(1)
      expect(mainCtrl.requests.userRequests).toHaveLength(0)
      expect(mainCtrl.requests.requestWindow.windowProps).toBe(null)
    })

    test('keeps a message of the previous account queued behind the connect request', async () => {
      const mainCtrl = await prepareSwitchTest()
      const connectReject = jest.fn()
      const messageReject = jest.fn()
      await mainCtrl.requests.addUserRequests([
        makeConnectRequest(connectReject),
        makeMessageRequest('message-request', fromAccount!.addr, messageReject)
      ])
      expect(mainCtrl.requests.currentUserRequest?.id).toBe('connect-request')

      await mainCtrl.selectAccount(toAccount!.addr)

      expect(connectReject).not.toHaveBeenCalled()
      expect(messageReject).not.toHaveBeenCalled()
      // The message belongs to the previous account, so it is hidden until it is selected again
      expect(mainCtrl.requests.visibleUserRequests.map((r) => r.id)).toEqual(['connect-request'])

      await mainCtrl.selectAccount(fromAccount!.addr)

      expect(mainCtrl.requests.visibleUserRequests.map((r) => r.id)).toEqual([
        'connect-request',
        'message-request'
      ])
    })
  })

  describe('commonHandlerForBroadcastSuccess for swaps', () => {
    const SIGNED_ROUTE_ID = 'signed-route'
    const TXN_ID = '0x8d94395e374c50feaaf22f940a18b85717609c667e9ff45368c45b3f2ee1b06f'

    const createQuote = (routeId: string) => {
      const route = { routeId, providerId: 'lifi', steps: [], userTxs: [] }

      return {
        fromAsset: { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH' },
        toAsset: { address: '0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB', symbol: 'JPYC' },
        selectedRoute: route,
        routes: [route]
      } as any
    }

    const createSwapAccountOps = (meta: Record<string, unknown> = {}) => {
      const accountOp = {
        accountAddr: accounts[0]!.addr,
        chainId: 1n,
        calls: [],
        meta: { swapTxn: { activeRouteId: SIGNED_ROUTE_ID, userTxIndex: 0, chainId: 1 }, ...meta }
      } as any
      const submittedAccountOp = {
        ...accountOp,
        // The sign controller passes a shallow copy of the meta
        meta: { ...accountOp.meta },
        txnId: TXN_ID,
        identifiedBy: { type: 'Transaction', identifier: TXN_ID }
      } as any

      return { accountOp, submittedAccountOp }
    }

    const setupController = async () => {
      const { mainCtrl } = await makeMainController(async (storageCtrl) => {
        await storageCtrl.set('accounts', accounts)
      })
      jest
        .spyOn(mainCtrl.swapAndBridge, 'handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate')
        .mockImplementation(() => {})
      jest.spyOn(mainCtrl.activity, 'addAccountOp').mockImplementation(async () => {})
      jest.spyOn(mainCtrl.ui.notification, 'create').mockImplementation(async () => {})

      return mainCtrl
    }

    afterEach(() => {
      jest.restoreAllMocks()
    })

    test('should add the active route from the quote the swap was built from', async () => {
      const mainCtrl = await setupController()
      mainCtrl.swapAndBridge.quote = createQuote(SIGNED_ROUTE_ID)

      await mainCtrl.commonHandlerForBroadcastSuccess(createSwapAccountOps())

      const [activeRoute] = mainCtrl.swapAndBridge.activeRoutes
      expect(mainCtrl.swapAndBridge.activeRoutes).toHaveLength(1)
      expect(activeRoute!.activeRouteId).toBe(SIGNED_ROUTE_ID)
      expect(activeRoute!.routeStatus).toBe('in-progress')
      expect(activeRoute!.userTxHash).toBe(TXN_ID)
    })

    test('should not add an active route from a quote that is not the signed one', async () => {
      const mainCtrl = await setupController()
      // e.g. the form refreshed the quote while the user was confirming on a hardware wallet
      mainCtrl.swapAndBridge.quote = createQuote('refreshed-route')

      await mainCtrl.commonHandlerForBroadcastSuccess(createSwapAccountOps())

      expect(mainCtrl.swapAndBridge.activeRoutes).toHaveLength(0)
    })

    test('should not store the quote of a Safe batch swap in the activity', async () => {
      const mainCtrl = await setupController()
      // Safe accounts pass the quote along with the swap when adding it to the batch
      const accountOps = createSwapAccountOps({ quote: createQuote(SIGNED_ROUTE_ID) })

      await mainCtrl.commonHandlerForBroadcastSuccess(accountOps)

      // The quote is still used to add the active route before it's deleted
      expect(mainCtrl.swapAndBridge.activeRoutes).toHaveLength(1)
      const [storedAccountOp] = jest.mocked(mainCtrl.activity.addAccountOp).mock.calls[0]!
      expect(storedAccountOp.meta).not.toHaveProperty('quote')
      expect(storedAccountOp.meta?.swapTxn?.activeRouteId).toBe(SIGNED_ROUTE_ID)
    })
  })
})
