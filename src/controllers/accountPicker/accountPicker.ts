import { getCreate2Address, keccak256 } from 'ethers'

import ExternalSignerError from '../../classes/ExternalSignerError'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { PROXY_AMBIRE_ACCOUNT } from '../../consts/deploy'
import {
  HD_PATH_TEMPLATE_TYPE,
  SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
} from '../../consts/derivation'
import {
  Account,
  AccountOnchainState,
  AccountOnPage,
  AccountWithNetworkMeta,
  DerivedAccount,
  DerivedAccountWithoutNetworkMeta,
  SelectedAccountForImport
} from '../../interfaces/account'
import { Fetch } from '../../interfaces/fetch'
import { KeyIterator } from '../../interfaces/keyIterator'
import { dedicatedToOneSAPriv, ReadyToAddKeys } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import {
  getAccountImportStatus,
  getBasicAccount,
  getDefaultAccountPreferences,
  getEmailAccount,
  getSmartAccount,
  isAmbireV1LinkedAccount,
  isDerivedForSmartAccountKeyOnly,
  isSmartAccount
} from '../../libs/account/account'
import { getAccountState } from '../../libs/accountState/accountState'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
/* eslint-disable @typescript-eslint/no-floating-promises */
import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'

export const DEFAULT_PAGE = 1
export const DEFAULT_PAGE_SIZE = 5
const DEFAULT_SHOULD_SEARCH_FOR_LINKED_ACCOUNTS = true
const DEFAULT_SHOULD_GET_ACCOUNTS_USED_ON_NETWORKS = true

/**
 * Account Picker Controller
 * is responsible for listing accounts that can be selected for adding, and for
 * adding (creating) identity for the smart accounts (if needed) on the Relayer.
 * It uses a KeyIterator interface allow iterating all the keys in a specific
 * underlying store such as a hardware device or an object holding a seed.
 */
export class AccountPickerController extends EventEmitter {
  #callRelayer: Function

  #accounts: AccountsController

  #keystore: KeystoreController

  #networks: NetworksController

  #providers: ProvidersController

  keyIterator?: KeyIterator | null

  hdPathTemplate?: HD_PATH_TEMPLATE_TYPE

  isInitialized: boolean = false

  isInitializedWithSavedSeed: boolean = false

  shouldSearchForLinkedAccounts = DEFAULT_SHOULD_SEARCH_FOR_LINKED_ACCOUNTS

  shouldGetAccountsUsedOnNetworks = DEFAULT_SHOULD_GET_ACCOUNTS_USED_ON_NETWORKS

  /* This is only the index of the current page */
  page: number = DEFAULT_PAGE

  /* The number of accounts to be displayed on a single page */
  pageSize: number = this.subType === 'private-key' ? 1 : 5

  /* State to indicate the page requested fails to load (and the reason why) */
  pageError: null | string = null

  selectedAccountsFromCurrentSession: SelectedAccountForImport[] = []

  // Accounts which identity is created on the Relayer (if needed), and are ready
  // to be added to the user's account list by the Main Controller
  readyToAddAccounts: Account[] = []

  // Accounts that were selected in a previous session but are now deselected in the current one
  readyToRemoveAccounts: Account[] = []

  // The keys for the `readyToAddAccounts`, that are ready to be added to the
  // user's keystore by the Main Controller
  readyToAddKeys: ReadyToAddKeys = { internal: [], external: [] }

  // Identity for the smart accounts must be created on the Relayer, this
  // represents the status of the operation, needed managing UI state
  addAccountsStatus: 'LOADING' | 'SUCCESS' | 'INITIAL' = 'INITIAL'

  selectNextAccountStatus: 'LOADING' | 'SUCCESS' | 'INITIAL' = 'INITIAL'

  #addedAccountsFromCurrentSession: Account[] = []

  accountsLoading: boolean = false

  linkedAccountsLoading: boolean = false

  networksWithAccountStateError: bigint[] = []

  #derivedAccounts: DerivedAccount[] = []

  #linkedAccounts: { account: AccountWithNetworkMeta; isLinked: boolean }[] = []

  #alreadyImportedAccounts: Account[] = []

  #onAddAccountsSuccessCallback: () => Promise<void>

  #onAddAccountsSuccessCallbackPromise?: Promise<void>

  #shouldDebounceFlags: { [key: string]: boolean } = {}

  constructor({
    accounts,
    keystore,
    networks,
    providers,
    relayerUrl,
    fetch,
    onAddAccountsSuccessCallback
  }: {
    accounts: AccountsController
    keystore: KeystoreController
    networks: NetworksController
    providers: ProvidersController
    relayerUrl: string
    fetch: Fetch
    onAddAccountsSuccessCallback: () => Promise<void>
  }) {
    super()
    this.#accounts = accounts
    this.#keystore = keystore
    this.#networks = networks
    this.#providers = providers
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.#onAddAccountsSuccessCallback = onAddAccountsSuccessCallback

    this.#accounts.onUpdate(() => {
      this.#debounceFunctionCalls(
        'update-accounts',
        () => {
          if (!this.isInitialized) return
          if (this.addAccountsStatus !== 'INITIAL') return

          this.#updateStateWithTheLatestFromAccounts()
        },
        20
      )
    })
  }

  get accountsOnPage(): AccountOnPage[] {
    const processedAccounts = this.#derivedAccounts
      // The displayed (visible) accounts on page should not include the derived
      // EOA (basic) accounts only used as smart account keys, they should not
      // be visible nor importable (or selectable).
      .filter((x) => !isDerivedForSmartAccountKeyOnly(x.index))
      .flatMap((derivedAccount) => {
        const associatedLinkedAccounts = this.#linkedAccounts.filter(
          (linkedAcc) =>
            !isSmartAccount(derivedAccount.account) &&
            linkedAcc.account.associatedKeys.includes(derivedAccount.account.addr)
        )

        const correspondingSmartAccount = this.#derivedAccounts.find(
          (acc) => isSmartAccount(acc.account) && acc.slot === derivedAccount.slot
        )

        let accountsToReturn: Omit<AccountOnPage, 'importStatus'>[] = []

        if (!isSmartAccount(derivedAccount.account)) {
          accountsToReturn.push(derivedAccount)

          const duplicate = associatedLinkedAccounts.find(
            (linkedAcc) => linkedAcc.account.addr === correspondingSmartAccount?.account?.addr
          )

          // The derived smart account that matches the relayer's linked account
          // should not be displayed as linked account. Use this cycle to mark it.
          if (duplicate) duplicate.isLinked = false

          if (!duplicate && correspondingSmartAccount) {
            accountsToReturn.push(correspondingSmartAccount)
          }
        }

        accountsToReturn = accountsToReturn.concat(
          associatedLinkedAccounts.map((linkedAcc) => ({
            ...linkedAcc,
            slot: derivedAccount.slot,
            index: derivedAccount.index
          }))
        )

        return accountsToReturn
      })

    const unprocessedLinkedAccounts = this.#linkedAccounts
      .filter(
        (linkedAcc) =>
          !processedAccounts.find(
            (processedAcc) => processedAcc?.account.addr === linkedAcc.account.addr
          )
      )
      // Use `flatMap` instead of `map` in order to auto remove missing values.
      // The `flatMap` has a built-in mechanism to flatten the array and remove
      // null or undefined values (by returning empty array).
      .flatMap((linkedAcc) => {
        const correspondingDerivedAccount = this.#derivedAccounts.find((derivedAccount) =>
          linkedAcc.account.associatedKeys.includes(derivedAccount.account.addr)
        )

        // The `correspondingDerivedAccount` should always be found, except when
        // something is wrong with the data we have stored on the Relayer.
        // The this.#verifyLinkedAndDerivedAccounts() method should have
        // already emitted an error in that case. Do not emit here, since
        // this is a getter method (and emitting here is a no-go).
        if (!correspondingDerivedAccount) return []

        return [
          {
            ...linkedAcc,
            slot: correspondingDerivedAccount.slot,
            index: correspondingDerivedAccount.index
          }
        ]
      })

    const mergedAccounts = [...processedAccounts, ...unprocessedLinkedAccounts]

    mergedAccounts.sort((a, b) => {
      const prioritizeAccountType = (item: any) => {
        if (!isSmartAccount(item.account)) return -1
        if (item.isLinked) return 1

        return 0
      }

      return prioritizeAccountType(a) - prioritizeAccountType(b) || a.slot - b.slot
    })

    return mergedAccounts.map((acc) => ({
      ...acc,
      importStatus: getAccountImportStatus({
        account: acc.account,
        alreadyImportedAccounts: this.#alreadyImportedAccounts,
        keys: this.#keystore.keys,
        accountsOnPage: mergedAccounts,
        keyIteratorType: this.keyIterator?.type
      })
    }))
  }

  get selectedAccounts(): SelectedAccountForImport[] {
    const accountsAddrOnPage = this.#alreadyImportedAccounts.map((a) => a.addr)
    const selectedAccountsFromPrevSession = this.accountsOnPage
      .filter((a) => accountsAddrOnPage.includes(a.account.addr))
      .map((a) => {
        const accountsOnPageWithThisAcc = this.accountsOnPage.filter(
          (accOnPage) => accOnPage.account.addr === a.account.addr
        )
        const accountKeys = this.#getAccountKeys(a.account, accountsOnPageWithThisAcc)

        return {
          account: a.account,
          isLinked: a.isLinked,
          accountKeys: accountKeys.map((accKey) => ({
            addr: accKey.account.addr,
            slot: accKey.slot,
            index: accKey.index
          }))
        } as SelectedAccountForImport
      })

    const nextSelectedAccount = [
      ...selectedAccountsFromPrevSession,
      ...this.selectedAccountsFromCurrentSession
    ]

    const readyToRemoveAccountsAddr = this.readyToRemoveAccounts.map((a) => a.addr)

    return nextSelectedAccount.filter((a) => !readyToRemoveAccountsAddr.includes(a.account.addr))
  }

  get addedAccountsFromCurrentSession() {
    return this.#addedAccountsFromCurrentSession
  }

  set addedAccountsFromCurrentSession(val: Account[]) {
    this.#addedAccountsFromCurrentSession = Array.from(
      new Map(val.map((account) => [account.addr, account])).values()
    )
  }

  async #isKeyIteratorInitializedWithTheSavedSeed() {
    if (this.keyIterator?.subType !== 'seed') return false

    if (!this.#keystore.hasKeystoreSavedSeed) return false

    const savedSeed = await this.#keystore.getSavedSeed()
    if (!savedSeed) return false

    return !!this.keyIterator?.isSeedMatching?.(savedSeed.seed)
  }

  async #getInitialHdPathTemplate(defaultHdPathTemplate: HD_PATH_TEMPLATE_TYPE) {
    if (!this.isInitializedWithSavedSeed) return defaultHdPathTemplate

    const savedSeed = await this.#keystore.getSavedSeed()
    return savedSeed.hdPathTemplate || defaultHdPathTemplate
  }

  async init({
    keyIterator,
    page,
    pageSize,
    hdPathTemplate,
    shouldSearchForLinkedAccounts = DEFAULT_SHOULD_SEARCH_FOR_LINKED_ACCOUNTS,
    shouldGetAccountsUsedOnNetworks = DEFAULT_SHOULD_GET_ACCOUNTS_USED_ON_NETWORKS
  }: {
    keyIterator: KeyIterator | null
    page?: number
    pageSize?: number
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE
    shouldSearchForLinkedAccounts?: boolean
    shouldGetAccountsUsedOnNetworks?: boolean
  }) {
    await this.reset()
    this.keyIterator = keyIterator
    if (!this.keyIterator) return this.#throwMissingKeyIterator()
    this.page = page || DEFAULT_PAGE
    if (pageSize) this.pageSize = pageSize
    this.isInitializedWithSavedSeed = await this.#isKeyIteratorInitializedWithTheSavedSeed()
    this.hdPathTemplate = await this.#getInitialHdPathTemplate(hdPathTemplate)
    this.isInitialized = true
    this.#alreadyImportedAccounts = [...this.#accounts.accounts]
    this.shouldSearchForLinkedAccounts = shouldSearchForLinkedAccounts
    this.shouldGetAccountsUsedOnNetworks = shouldGetAccountsUsedOnNetworks

    await this.forceEmitUpdate()
  }

  get type() {
    return this.keyIterator?.type
  }

  get subType() {
    return this.keyIterator?.subType
  }

  async reset() {
    this.keyIterator = null
    this.selectedAccountsFromCurrentSession = []
    this.page = DEFAULT_PAGE
    this.pageSize = DEFAULT_PAGE_SIZE
    this.hdPathTemplate = undefined
    this.shouldSearchForLinkedAccounts = DEFAULT_SHOULD_SEARCH_FOR_LINKED_ACCOUNTS
    this.shouldGetAccountsUsedOnNetworks = DEFAULT_SHOULD_GET_ACCOUNTS_USED_ON_NETWORKS

    this.addAccountsStatus = 'INITIAL'
    this.#derivedAccounts = []
    this.#linkedAccounts = []
    this.readyToAddAccounts = []
    this.networksWithAccountStateError = []
    this.readyToAddKeys = { internal: [], external: [] }
    this.isInitialized = false
    this.isInitializedWithSavedSeed = false
    this.addedAccountsFromCurrentSession = []

    await this.forceEmitUpdate()
  }

  resetAccountsSelection() {
    this.selectedAccountsFromCurrentSession = []
    this.readyToRemoveAccounts = []

    this.emitUpdate()
  }

  async setHDPathTemplate({ hdPathTemplate }: { hdPathTemplate: HD_PATH_TEMPLATE_TYPE }) {
    this.hdPathTemplate = hdPathTemplate

    // Reset the currently selected accounts, because for the keys of these
    // accounts, as of v4.32.0, we don't store their hd path. When import
    // completes, only the latest hd path of the controller is stored.
    this.selectedAccountsFromCurrentSession = []

    await this.setPage({ page: DEFAULT_PAGE }) // takes the user back on the first page
  }

  #getAccountKeys(account: Account, accountsOnPageWithThisAcc: AccountOnPage[]) {
    // should never happen
    if (accountsOnPageWithThisAcc.length === 0) {
      console.error(`accountPicker: account ${account.addr} was not found in the accountsOnPage.`)
      return []
    }

    // Case 1: The account is a Basic account
    const isBasicAcc = !isSmartAccount(account)
    // The key of the Basic account is the basic account itself
    if (isBasicAcc) return accountsOnPageWithThisAcc

    // Case 2: The account is a Smart account, but not a linked one
    const isSmartAccountAndNotLinked =
      isSmartAccount(account) &&
      accountsOnPageWithThisAcc.length === 1 &&
      accountsOnPageWithThisAcc[0].isLinked === false

    if (isSmartAccountAndNotLinked) {
      // The key of the smart account is the Basic account on the same slot
      // that is explicitly derived for a smart account key only.
      const basicAccOnThisSlotDerivedForSmartAccKey = this.#derivedAccounts.find(
        (a) =>
          a.slot === accountsOnPageWithThisAcc[0].slot &&
          !isSmartAccount(a.account) &&
          isDerivedForSmartAccountKeyOnly(a.index)
      )

      return basicAccOnThisSlotDerivedForSmartAccKey
        ? [basicAccOnThisSlotDerivedForSmartAccKey]
        : []
    }

    // Case 3: The account is a Smart account and a linked one. For this case,
    // there could exist multiple keys (basic accounts) found on different slots.
    const basicAccOnEverySlotWhereThisAddrIsFound = accountsOnPageWithThisAcc
      .map((a) => a.slot)
      .flatMap((slot) => {
        const basicAccOnThisSlot = this.#derivedAccounts.find(
          (a) =>
            a.slot === slot &&
            !isSmartAccount(a.account) &&
            // The key of the linked account is always the EOA (basic) account
            // on the same slot that is not explicitly used for smart account keys only.
            !isDerivedForSmartAccountKeyOnly(a.index)
        )

        return basicAccOnThisSlot ? [basicAccOnThisSlot] : []
      })

    return basicAccOnEverySlotWhereThisAddrIsFound
  }

  selectAccount(_account: Account) {
    if (!this.isInitialized) return this.#throwNotInitialized()
    if (!this.keyIterator) return this.#throwMissingKeyIterator()

    // Needed, because linked accounts could have multiple keys (basic accounts),
    // and therefore - same linked account could be found on different slots.
    const accountsOnPageWithThisAcc = this.accountsOnPage.filter(
      (accOnPage) => accOnPage.account.addr === _account.addr
    )
    const accountKeys = this.#getAccountKeys(_account, accountsOnPageWithThisAcc)
    if (!accountKeys.length)
      return this.emitError({
        level: 'major',
        message: `Selecting ${_account.addr} account failed because the details for this account are missing. Please try again or contact support if the problem persists.`,
        error: new Error(
          `Trying to select ${_account.addr} account, but this account was not found in the accountsOnPage or it's keys were not found.`
        )
      })

    const nextSelectedAccount = {
      account: _account,
      // If the account has more than 1 key, it is for sure linked account,
      // since Basic accounts have only 1 key and smart accounts with more than
      // one key present should always be found as linked accounts anyways.
      isLinked: accountKeys.length > 1,
      accountKeys: accountKeys.map((a) => ({
        addr: a.account.addr,
        slot: a.slot,
        index: a.index
      }))
    }

    const accountExists = this.selectedAccountsFromCurrentSession.some(
      (x) => x.account.addr === nextSelectedAccount.account.addr
    )
    if (!accountExists) this.selectedAccountsFromCurrentSession.push(nextSelectedAccount)

    this.emitUpdate()
  }

  deselectAccount(account: Account) {
    if (!this.isInitialized) return this.#throwNotInitialized()
    if (!this.keyIterator) return this.#throwMissingKeyIterator()

    if (this.selectedAccounts.find((x) => x.account.addr === account.addr)) {
      this.selectedAccountsFromCurrentSession = this.selectedAccountsFromCurrentSession.filter(
        (a) => a.account.addr !== account.addr
      )
      const accountInAlreadyAddedAccounts = this.#alreadyImportedAccounts.find(
        (a) => a.addr === account.addr
      )

      if (accountInAlreadyAddedAccounts) {
        const accountInReadyToRemoveAccounts = this.readyToRemoveAccounts.find(
          (a) => a.addr === account.addr
        )
        if (!accountInReadyToRemoveAccounts) this.readyToRemoveAccounts.push(account)
      }
      this.emitUpdate()
    } else {
      return this.emitError({
        level: 'major',
        message: 'This account cannot be deselected. Please reload and try again.',
        error: new Error('accountPicker: account not found. Cannot deselect.')
      })
    }
  }

  /**
   * For internal keys only! Returns the ready to be added internal (private)
   * keys of the currently selected accounts.
   */
  retrieveInternalKeysOfSelectedAccounts() {
    if (!this.hdPathTemplate) {
      this.#throwMissingHdPath()
      return []
    }

    if (!this.keyIterator?.retrieveInternalKeys) {
      this.#throwMissingKeyIteratorRetrieveInternalKeysMethod()
      return []
    }

    return this.keyIterator?.retrieveInternalKeys(
      this.selectedAccountsFromCurrentSession,
      this.hdPathTemplate,
      this.#keystore.keys
    )
  }

  /**
   * Prevents requesting the next page before the current one is fully loaded.
   * This avoids race conditions where the user requests the next page before
   * linked accounts are fully loaded, causing misleadingly failing `#verifyLinkedAccounts` checks.
   */
  get isPageLocked() {
    return this.accountsLoading || this.linkedAccountsLoading
  }

  async setPage({ page = this.page }: { page: number }): Promise<void> {
    if (!this.isInitialized) return this.#throwNotInitialized()
    if (!this.keyIterator) return this.#throwMissingKeyIterator()

    if (page === this.page && this.#derivedAccounts.length) return

    this.page = page
    this.pageError = null
    this.#derivedAccounts = []
    this.#linkedAccounts = []
    this.accountsLoading = true
    this.networksWithAccountStateError = []
    this.emitUpdate()

    if (page <= 0) {
      this.pageError = `Unexpected page was requested (page ${page}). Please try again or contact support for help.`
      this.page = DEFAULT_PAGE // fallback to the default (initial) page
      this.emitUpdate()
      return
    }

    try {
      this.#derivedAccounts = await this.#deriveAccounts()

      if (this.keyIterator?.type === 'internal' && this.keyIterator?.subType === 'private-key') {
        const accountsOnPageWithoutTheLinked = this.accountsOnPage.filter((acc) => !acc.isLinked)
        const usedAccounts = accountsOnPageWithoutTheLinked.filter(
          (acc) => acc.account.usedOnNetworks.length
        )

        // If at least one account is used - preselect all accounts on the page
        // (except the linked ones). Usually there are are two accounts
        // (since the private key flow gas `pageSize` of 1)
        if (usedAccounts.length) {
          accountsOnPageWithoutTheLinked.forEach((acc) => this.selectAccount(acc.account))
        }
      }
    } catch (e: any) {
      const fallbackMessage = `Failed to retrieve accounts on page ${this.page}. Please try again or contact support for assistance. Error details: ${e?.message}.`
      this.pageError = e instanceof ExternalSignerError ? e.message : fallbackMessage
    }
    this.accountsLoading = false
    this.emitUpdate()

    await this.#findAndSetLinkedAccounts({
      accounts: this.#derivedAccounts
        .filter(
          (acc) =>
            // Search for linked accounts to the basic (EOA) accounts only.
            // Searching for linked accounts to another Ambire smart accounts
            // is a feature that Ambire is yet to support.
            !isSmartAccount(acc.account) &&
            // Skip searching for linked accounts to the derived EOA (basic)
            // accounts that are used for smart account keys only. They are
            // solely purposed to manage 1 particular (smart) account,
            // not at all for linking.
            !isDerivedForSmartAccountKeyOnly(acc.index)
        )
        .map((acc) => acc.account)
    })
  }

  #updateStateWithTheLatestFromAccounts() {
    this.#alreadyImportedAccounts = [...this.#accounts.accounts]

    this.addedAccountsFromCurrentSession = Array.from(
      new Set([
        ...(this.addedAccountsFromCurrentSession
          .map((a) => this.#accounts.accounts.find((acc) => acc.addr === a.addr))
          .filter(Boolean) as Account[])
      ])
    )
    this.#derivedAccounts = this.#derivedAccounts.map((derivedAcc) => {
      const updatedAccount = this.#accounts.accounts.find(
        (acc) => acc.addr === derivedAcc.account.addr
      )

      if (updatedAccount) {
        return {
          ...derivedAcc,
          account: { ...derivedAcc.account, ...updatedAccount }
        }
      }

      return derivedAcc
    })

    const accountsAddr = this.#accounts.accounts.map((a) => a.addr)
    this.readyToRemoveAccounts = this.readyToRemoveAccounts.filter((a) =>
      accountsAddr.includes(a.addr)
    )
    this.readyToAddAccounts = this.readyToAddAccounts.filter((a) => !accountsAddr.includes(a.addr))

    this.emitUpdate()
  }

  /**
   * Triggers the process of adding accounts via the AccountPicker flow by
   * creating identity for the smart accounts (if needed) on the Relayer.
   * Then the `onAccountPickerSuccess` listener in the Main Controller gets
   * triggered, which uses the `readyToAdd...` properties to further set
   * the newly added accounts data (like preferences, keys and others)
   */
  async addAccounts(
    accounts: SelectedAccountForImport[] = [],
    readyToAddKeys: ReadyToAddKeys = { internal: [], external: [] }
  ) {
    if (!this.isInitialized) return this.#throwNotInitialized()
    if (!this.keyIterator) return this.#throwMissingKeyIterator()

    this.addAccountsStatus = 'LOADING'
    await this.forceEmitUpdate()

    let newlyCreatedAccounts: Account['addr'][] = []
    const accountsToAddOnRelayer: SelectedAccountForImport[] = accounts
      // Identity only for the smart accounts must be created on the Relayer
      .filter((x) => isSmartAccount(x.account))
      // Skip creating identity for Ambire v1 smart accounts
      .filter((x) => !isAmbireV1LinkedAccount(x.account.creation?.factoryAddr))

    if (accountsToAddOnRelayer.length) {
      const body = accountsToAddOnRelayer.map(({ account }: SelectedAccountForImport) => ({
        addr: account.addr,
        ...(account.email ? { email: account.email } : {}),
        associatedKeys: account.initialPrivileges,
        creation: {
          factoryAddr: account.creation!.factoryAddr,
          salt: account.creation!.salt,
          baseIdentityAddr: PROXY_AMBIRE_ACCOUNT
        }
      }))

      try {
        const res = await this.#callRelayer('/v2/identity/create-multiple', 'POST', {
          accounts: body
        })

        if (!res.success) {
          throw new Error(res?.message || 'No response received from the Ambire Relayer.')
        }

        type AccResType = {
          identity: string
          status: {
            created: boolean
            reason?: string
          }
        }

        type BodyType = AccResType[]
        if (res.body) {
          newlyCreatedAccounts = (res.body as BodyType)
            .filter((acc: AccResType) => acc.status.created)
            .map((acc: AccResType) => acc.identity)
        }
      } catch (e: any) {
        this.emitError({
          level: 'major',
          message:
            'Error when adding accounts on the Ambire Relayer. Please try again later or contact support if the problem persists.',
          error: new Error(e?.message)
        })

        this.addAccountsStatus = 'INITIAL'
        await this.forceEmitUpdate()
        return
      }
    }

    this.readyToAddAccounts = [
      ...accounts.map((x, i) => {
        const alreadyImportedAcc = this.#alreadyImportedAccounts.find(
          (a) => a.addr === x.account.addr
        )

        return {
          ...x.account,
          // Persist the already imported account preferences on purpose, otherwise,
          // re-importing the same account via different key type(s) would reset them.
          preferences: alreadyImportedAcc
            ? alreadyImportedAcc.preferences
            : getDefaultAccountPreferences(x.account.addr, this.#alreadyImportedAccounts, i),
          newlyCreated: newlyCreatedAccounts.includes(x.account.addr)
        }
      })
    ]
    this.readyToAddKeys = readyToAddKeys

    this.addedAccountsFromCurrentSession = [
      ...this.addedAccountsFromCurrentSession,
      ...this.readyToAddAccounts
    ]
    this.selectedAccountsFromCurrentSession = []
    this.#onAddAccountsSuccessCallbackPromise = this.#onAddAccountsSuccessCallback().finally(() => {
      this.#onAddAccountsSuccessCallbackPromise = undefined
    })
    await this.#onAddAccountsSuccessCallbackPromise

    this.addAccountsStatus = 'SUCCESS'
    await this.forceEmitUpdate()

    this.#updateStateWithTheLatestFromAccounts()

    // reset the addAccountsStatus in the next tick to ensure the FE receives the 'SUCCESS' state
    this.addAccountsStatus = 'INITIAL'
    await this.forceEmitUpdate()
  }

  async selectNextAccount() {
    if (!this.isInitialized) return this.#throwNotInitialized()

    if (!this.keyIterator) return this.#throwMissingKeyIterator()

    this.selectNextAccountStatus = 'LOADING'
    await this.forceEmitUpdate()

    let currentPage: number = this.page
    let nextAccount: AccountWithNetworkMeta | undefined

    while (true) {
      // Load the accounts for the current page
      // eslint-disable-next-line no-await-in-loop
      await this.setPage({ page: currentPage })

      nextAccount = this.accountsOnPage.find(
        ({ isLinked, account }) =>
          !isLinked &&
          !isSmartAccount(account) &&
          !this.#accounts.accounts.some((a) => a.addr === account.addr)
      )?.account

      if (nextAccount) {
        this.selectAccount(nextAccount)
        break
      }

      // If no account found on the page, move to the next page
      currentPage++
    }
    this.selectNextAccountStatus = 'SUCCESS'
    await this.forceEmitUpdate()

    this.selectNextAccountStatus = 'INITIAL'
    await this.forceEmitUpdate()
  }

  async createAndAddEmailAccount(selectedAccount: SelectedAccountForImport) {
    const {
      account: { email },
      accountKeys: [recoveryKey]
    } = selectedAccount
    if (!this.isInitialized) return this.#throwNotInitialized()
    if (!this.keyIterator) return this.#throwMissingKeyIterator()

    const keyPublicAddress: string = (await this.keyIterator.retrieve([{ from: 0, to: 1 }]))[0]

    const emailSmartAccount = await getEmailAccount(
      {
        emailFrom: email!,
        secondaryKey: recoveryKey.addr
      },
      keyPublicAddress
    )

    await this.addAccounts([{ ...selectedAccount, account: { ...emailSmartAccount, email } }])
  }

  // updates the account picker state so the main ctrl receives the readyToAddAccounts
  // that should be added to the storage of the app
  async addExistingEmailAccounts(accounts: Account[]) {
    // There is no need to call the addAccounts method in order to add that
    // account to the relayer because this func will be called only for accounts returned
    // from relayer that only need to be stored in the storage of the app
    this.readyToAddAccounts = accounts
    this.addAccountsStatus = 'SUCCESS'
    this.emitUpdate()
  }

  removeNetworkData(chainId: bigint) {
    this.networksWithAccountStateError = this.networksWithAccountStateError.filter(
      (n) => n !== chainId
    )
    this.emitUpdate()
  }

  async #deriveAccounts(): Promise<DerivedAccount[]> {
    // Should never happen, because before the #deriveAccounts method gets
    // called - there is a check if the keyIterator exists.
    if (!this.keyIterator) {
      console.error('accountPicker: missing keyIterator')
      return []
    }

    const accounts: DerivedAccountWithoutNetworkMeta[] = []

    const startIdx = (this.page - 1) * this.pageSize
    const endIdx = (this.page - 1) * this.pageSize + (this.pageSize - 1)

    const indicesToRetrieve = [
      { from: startIdx, to: endIdx } // Indices for the basic (EOA) accounts
    ]
    // Since v4.31.0, do not retrieve smart accounts for the private key
    // type. That's because we can't use the common derivation offset
    // (SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET), and deriving smart
    // accounts out of the private key (with another approach - salt and
    // extra entropy) was creating confusion.
    const shouldRetrieveSmartAccountIndices = this.keyIterator.type !== 'private-key'
    if (shouldRetrieveSmartAccountIndices) {
      // Indices for the smart accounts.
      indicesToRetrieve.push({
        from: startIdx + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET,
        to: endIdx + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
      })
    }
    // Combine the requests for all accounts in one call to the keyIterator.
    // That's optimization primarily focused on hardware wallets, to reduce the
    // number of calls to the hardware device. This is important, especially
    // for Trezor, because it fires a confirmation popup for each call.
    const combinedBasicAndSmartAccKeys = await this.keyIterator.retrieve(
      indicesToRetrieve,
      this.hdPathTemplate
    )

    const basicAccKeys = combinedBasicAndSmartAccKeys.slice(0, this.pageSize)
    const smartAccKeys = combinedBasicAndSmartAccKeys.slice(
      this.pageSize,
      combinedBasicAndSmartAccKeys.length
    )

    const smartAccountsPromises: Promise<DerivedAccountWithoutNetworkMeta | null>[] = []
    // Replace the parallel getKeys with foreach to prevent issues with Ledger,
    // which can only handle one request at a time.
    // eslint-disable-next-line no-restricted-syntax
    for (const [index, smartAccKey] of smartAccKeys.entries()) {
      const slot = startIdx + (index + 1)

      // The derived EOA (basic) account which is the key for the smart account
      const account = getBasicAccount(smartAccKey, this.#accounts.accounts)
      const indexWithOffset = slot - 1 + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
      accounts.push({ account, isLinked: false, slot, index: indexWithOffset })

      // Derive the Ambire (smart) account
      smartAccountsPromises.push(
        getSmartAccount(
          [{ addr: smartAccKey, hash: dedicatedToOneSAPriv }],
          this.#accounts.accounts
        )
          .then((smartAccount) => {
            return { account: smartAccount, isLinked: false, slot, index: slot - 1 }
          })
          // If the error isn't caught here and the promise is rejected, Promise.all
          // will be rejected entirely.
          .catch(() => {
            // No need for emitting an error here, because a relevant error is already
            // emitted in the method #getAccountsUsedOnNetworks
            return null
          })
      )
    }

    const unfilteredSmartAccountsList = await Promise.all(smartAccountsPromises)
    const smartAccounts = unfilteredSmartAccountsList.filter(
      (x) => x !== null
    ) as DerivedAccountWithoutNetworkMeta[]

    accounts.push(...smartAccounts)

    // eslint-disable-next-line no-restricted-syntax
    for (const [index, basicAccKey] of basicAccKeys.entries()) {
      const slot = startIdx + (index + 1)

      // The EOA (basic) account on this slot
      const account = getBasicAccount(basicAccKey, this.#accounts.accounts)
      accounts.push({ account, isLinked: false, slot, index: slot - 1 })
    }

    const accountsWithNetworks = await this.#getAccountsUsedOnNetworks({ accounts })

    return accountsWithNetworks
  }

  // inner func
  // eslint-disable-next-line class-methods-use-this
  async #getAccountsUsedOnNetworks({
    accounts
  }: {
    accounts: DerivedAccountWithoutNetworkMeta[]
  }): Promise<DerivedAccount[]> {
    if (!this.shouldGetAccountsUsedOnNetworks) {
      return accounts.map((a) => ({ ...a, account: { ...a.account, usedOnNetworks: [] } }))
    }

    const accountsObj: { [key: Account['addr']]: DerivedAccount } = Object.fromEntries(
      accounts.map((a) => [a.account.addr, { ...a, account: { ...a.account, usedOnNetworks: [] } }])
    )

    const networkLookup: { [key: string]: Network } = {}
    this.#networks.networks.forEach((network) => {
      networkLookup[network.chainId.toString()] = network
    })

    const promises = Object.keys(this.#providers.providers).map(async (chainId: string) => {
      const network = networkLookup[chainId]
      if (network) {
        const accountState = await getAccountState(
          this.#providers.providers[chainId],
          network,
          accounts.map((acc) => acc.account)
        ).catch(() => {
          console.error('accountPicker: failed to get account state on ', chainId)
          if (this.networksWithAccountStateError.includes(BigInt(chainId))) return
          this.networksWithAccountStateError.push(BigInt(chainId))
        })

        if (!accountState) return

        accountState.forEach((acc: AccountOnchainState) => {
          const isUsedOnThisNetwork =
            // Known limitation: checks only the native token balance. If this
            // account has any other tokens than native ones, this check will
            // fail to detect that the account was used on this network.
            acc.balance > BigInt(0) ||
            (acc.isEOA
              ? acc.nonce > BigInt(0)
              : // For smart accounts, check for 'isDeployed' instead because in
                // the erc-4337 scenario many cases might be missed with checking
                // the `acc.nonce`. For instance, `acc.nonce` could be 0, but user
                // might be actively using the account. This is because in erc-4337,
                // we use the entry point nonce. However, detecting the entry point
                // nonce is also not okay, because for various cases we do not use
                // sequential nonce - i.e., the entry point nonce could still be 0,
                // but the account is deployed. So the 'isDeployed' check is the
                // only reliable way to detect if account is used on network.
                acc.isDeployed)
          if (isUsedOnThisNetwork) {
            accountsObj[acc.accountAddr].account.usedOnNetworks.push(network)
          }
        })
      }
    })

    await Promise.all(promises)

    const finalAccountsWithNetworksArray = Object.values(accountsObj)

    // Preserve the original order of networks based on usedOnNetworks
    const sortedAccountsWithNetworksArray = finalAccountsWithNetworksArray.sort((a, b) => {
      const chainIdsA = a.account.usedOnNetworks.map((network) => network.chainId)
      const chainIdsB = b.account.usedOnNetworks.map((network) => network.chainId)
      const networkIndexA = this.#networks.networks.findIndex((network) =>
        chainIdsA.includes(network.chainId)
      )
      const networkIndexB = this.#networks.networks.findIndex((network) =>
        chainIdsB.includes(network.chainId)
      )
      return networkIndexA - networkIndexB
    })

    return sortedAccountsWithNetworksArray
  }

  async #findAndSetLinkedAccounts({ accounts }: { accounts: Account[] }) {
    if (!this.shouldSearchForLinkedAccounts) return

    if (accounts.length === 0) return

    this.linkedAccountsLoading = true
    this.emitUpdate()

    const keys = accounts.map((acc) => `keys[]=${acc.addr}`).join('&')
    const url = `/v2/account-by-key/linked/accounts?${keys}`

    const { data } = await this.#callRelayer(url)
    const linkedAccounts: { account: Account; isLinked: boolean }[] = Object.keys(
      data.accounts
    ).flatMap((addr: string) => {
      // In extremely rare cases, on the Relayer, the identity data could be
      // missing in the identities table but could exist in the logs table.
      // When this happens, the account data will be `null`.
      const isIdentityDataMissing = !data.accounts[addr]
      if (isIdentityDataMissing) {
        // Same error for both cases, because most prob
        this.emitError({
          level: 'minor',
          message: `The address ${addr} is not linked to an Ambire account. Please try again later or contact support if the problem persists.`,
          error: new Error(
            `The address ${addr} is not linked to an Ambire account. This could be because the identity data is missing in the identities table but could exist in the logs table.`
          )
        })

        return []
      }

      const { factoryAddr, bytecode, salt, associatedKeys } = data.accounts[addr]
      // Checks whether the account.addr matches the addr generated from the
      // factory. Should never happen, but could be a possible attack vector.
      const isInvalidAddress =
        getCreate2Address(factoryAddr, salt, keccak256(bytecode)).toLowerCase() !==
        addr.toLowerCase()
      if (isInvalidAddress) {
        const message = `The address ${addr} can't be verified to be a smart account address.`
        this.emitError({ level: 'minor', message, error: new Error(message) })

        return []
      }

      const existingAccount = this.#accounts.accounts.find((acc) => acc.addr === addr)
      return [
        {
          account: {
            addr,
            associatedKeys: Object.keys(associatedKeys),
            initialPrivileges: data.accounts[addr].initialPrivilegesAddrs.map((address: string) => [
              address,
              // this is a default privilege hex we add on account creation
              '0x0000000000000000000000000000000000000000000000000000000000000001'
            ]),
            creation: {
              factoryAddr,
              bytecode,
              salt
            },
            preferences: {
              label: existingAccount?.preferences.label || DEFAULT_ACCOUNT_LABEL,
              pfp: existingAccount?.preferences?.pfp || addr
            }
          },
          isLinked: true
        }
      ]
    })

    const linkedAccountsWithNetworks = await this.#getAccountsUsedOnNetworks({
      accounts: linkedAccounts as any
    })

    this.#linkedAccounts = linkedAccountsWithNetworks
    this.#verifyLinkedAccounts()

    this.linkedAccountsLoading = false
    this.emitUpdate()
  }

  /**
   * The corresponding derived account for the linked accounts should always be found,
   * except when something is wrong with the data we have stored on the Relayer.
   * Also, could be an attack vector. So indicate to the user that something is wrong.
   */
  #verifyLinkedAccounts() {
    this.#linkedAccounts.forEach((linkedAcc) => {
      const correspondingDerivedAccount = this.#derivedAccounts.find((derivedAccount) =>
        linkedAcc.account.associatedKeys.includes(derivedAccount.account.addr)
      )

      // The `correspondingDerivedAccount` should always be found,
      // except something is wrong with the data we have stored on the Relayer
      if (!correspondingDerivedAccount) {
        this.emitError({
          level: 'major',
          message: `Something went wrong with finding the corresponding account in the associated keys of the linked account with address ${linkedAcc.account.addr}. Please start the process again. If the problem persists, contact support.`,
          error: new Error(
            `Something went wrong with finding the corresponding account in the associated keys of the linked account with address ${linkedAcc.account.addr}.`
          )
        })
      }
    })
  }

  #throwNotInitialized() {
    this.emitError({
      level: 'major',
      message:
        'Something went wrong with deriving the accounts. Please start the process again. If the problem persists, contact support.',
      error: new Error(
        'accountPicker: requested a method of the AccountPicker controller, but the controller was not initialized'
      )
    })
  }

  #throwMissingKeyIterator() {
    this.emitError({
      level: 'major',
      message:
        'Something went wrong with deriving the accounts. Please start the process again. If the problem persists, contact support.',
      error: new Error('accountPicker: missing keyIterator')
    })
  }

  #throwMissingKeyIteratorRetrieveInternalKeysMethod() {
    this.emitError({
      level: 'major',
      message:
        'Retrieving internal keys failed. Please try to start the process of selecting accounts again. If the problem persist, please contact support.',
      error: new Error('accountPicker: missing retrieveInternalKeys method')
    })
  }

  #throwMissingHdPath() {
    this.emitError({
      level: 'major',
      message:
        'The HD path template is missing. Please try to start the process of selecting accounts again. If the problem persist, please contact support.',
      error: new Error('accountPicker: missing hdPathTemplate')
    })
  }

  #debounceFunctionCalls(funcName: string, func: () => void, ms: number = 0) {
    if (this.#shouldDebounceFlags[funcName]) return
    this.#shouldDebounceFlags[funcName] = true

    setTimeout(() => {
      this.#shouldDebounceFlags[funcName] = false
      try {
        func()
      } catch (error: any) {
        this.emitError({
          level: 'minor',
          message: `The execution of ${funcName} in the AccountPickerController failed`,
          error
        })
      }
    }, ms)
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      // includes the getter in the stringified instance
      accountsOnPage: this.accountsOnPage,
      selectedAccounts: this.selectedAccounts,
      addedAccountsFromCurrentSession: this.addedAccountsFromCurrentSession,
      type: this.type,
      subType: this.subType,
      isPageLocked: this.isPageLocked
    }
  }
}

export default AccountPickerController
