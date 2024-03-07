/* eslint-disable @typescript-eslint/no-floating-promises */
import { ethers, JsonRpcProvider } from 'ethers'

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
import { KeyIterator } from '../../interfaces/keyIterator'
import { dedicatedToOneSAPriv, ReadyToAddKeys } from '../../interfaces/keystore'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { AccountPreferences, KeyPreferences } from '../../interfaces/settings'
import {
  getAccountImportStatus,
  getBasicAccount,
  getEmailAccount,
  getSmartAccount,
  isAmbireV1LinkedAccount,
  isDerivedForSmartAccountKeyOnly,
  isSmartAccount
} from '../../libs/account/account'
import { getAccountState } from '../../libs/accountState/accountState'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'
import { KeystoreController } from '../keystore/keystore'

export const DEFAULT_PAGE = 1
export const DEFAULT_PAGE_SIZE = 5

/**
 * Account Adder Controller
 * is responsible for listing accounts that can be selected for adding, and for
 * adding (creating) identity for the smart accounts (if needed) on the Relayer.
 * It uses a KeyIterator interface allow iterating all the keys in a specific
 * underlying store such as a hardware device or an object holding a seed.
 */
export class AccountAdderController extends EventEmitter {
  #callRelayer: Function

  #alreadyImportedAccounts: Account[]

  #keystore: KeystoreController

  #keyIterator?: KeyIterator | null

  hdPathTemplate?: HD_PATH_TEMPLATE_TYPE

  isInitialized: boolean = false

  // This is only the index of the current page
  page: number = DEFAULT_PAGE

  pageSize: number = DEFAULT_PAGE_SIZE

  selectedAccounts: SelectedAccountForImport[] = []

  // Accounts which identity is created on the Relayer (if needed), and are ready
  // to be added to the user's account list by the Main Controller
  readyToAddAccounts: (Account & { newlyCreated?: boolean })[] = []

  // The keys for the `readyToAddAccounts`, that are ready to be added to the
  // user's keystore by the Main Controller
  readyToAddKeys: ReadyToAddKeys = { internal: [], external: [] }

  // The key preferences for the `readyToAddKeys`, that are ready to be added to
  // the user's settings by the Main Controller
  readyToAddKeyPreferences: KeyPreferences = []

  // The account preferences for the `readyToAddAccounts`, that are ready to be
  // added to the user's settings by the Main Controller
  readyToAddAccountPreferences: AccountPreferences = {}

  // Identity for the smart accounts must be created on the Relayer, this
  // represents the status of the operation, needed managing UI state
  addAccountsStatus: 'LOADING' | 'SUCCESS' | 'INITIAL' = 'INITIAL'

  accountsLoading: boolean = false

  linkedAccountsLoading: boolean = false

  #derivedAccounts: DerivedAccount[] = []

  #linkedAccounts: { account: AccountWithNetworkMeta; isLinked: boolean }[] = []

  constructor({
    alreadyImportedAccounts,
    keystore,
    relayerUrl,
    fetch
  }: {
    alreadyImportedAccounts: Account[]
    keystore: KeystoreController
    relayerUrl: string
    fetch: Function
  }) {
    super()
    this.#alreadyImportedAccounts = alreadyImportedAccounts
    this.#keystore = keystore
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
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
        keyIteratorType: this.#keyIterator?.type
      })
    }))
  }

  init({
    keyIterator,
    page,
    pageSize,
    hdPathTemplate
  }: {
    keyIterator: KeyIterator | null
    page?: number
    pageSize?: number
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE
  }): void {
    this.#keyIterator = keyIterator
    if (!this.#keyIterator) return this.#throwMissingKeyIterator()

    this.page = page || DEFAULT_PAGE
    this.pageSize = pageSize || DEFAULT_PAGE_SIZE
    this.hdPathTemplate = hdPathTemplate
    this.isInitialized = true

    this.emitUpdate()
  }

  get type() {
    return this.#keyIterator?.type
  }

  get subType() {
    return this.#keyIterator?.subType
  }

  reset() {
    this.#keyIterator = null
    this.selectedAccounts = []
    this.page = DEFAULT_PAGE
    this.pageSize = DEFAULT_PAGE_SIZE
    this.hdPathTemplate = undefined

    this.addAccountsStatus = 'INITIAL'
    this.#derivedAccounts = []
    this.#linkedAccounts = []
    this.readyToAddAccounts = []
    this.readyToAddKeys = { internal: [], external: [] }
    this.readyToAddKeyPreferences = []
    this.readyToAddAccountPreferences = {}
    this.isInitialized = false

    this.emitUpdate()
  }

  // TODO: Not implemented yet
  setHDPathTemplate({
    path,
    networks,
    providers
  }: {
    path: HD_PATH_TEMPLATE_TYPE
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): void {
    this.hdPathTemplate = path
    this.page = DEFAULT_PAGE
    this.emitUpdate()
    // get the first page with the new hdPathTemplate (derivation)
    this.setPage({ page: DEFAULT_PAGE, networks, providers })
  }

  #getAccountKeys(account: Account, accountsOnPageWithThisAcc: AccountOnPage[]) {
    // should never happen
    if (accountsOnPageWithThisAcc.length === 0) {
      console.error(`accountAdder: account ${account.addr} was not found in the accountsOnPage.`)
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
    if (!this.#keyIterator) return this.#throwMissingKeyIterator()

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

    this.selectedAccounts.push({
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
    })
    this.emitUpdate()
  }

  async deselectAccount(account: Account) {
    if (!this.isInitialized) return this.#throwNotInitialized()
    if (!this.#keyIterator) return this.#throwMissingKeyIterator()

    const accIdx = this.selectedAccounts.findIndex((x) => x.account.addr === account.addr)

    if (accIdx !== -1) {
      this.selectedAccounts = this.selectedAccounts.filter((_, i) => i !== accIdx)
      this.emitUpdate()
    } else {
      return this.emitError({
        level: 'major',
        message: 'This account cannot be deselected. Please reload and try again.',
        error: new Error('accountAdder: account not found. Cannot deselect.')
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

    if (!this.#keyIterator?.retrieveInternalKeys) {
      this.#throwMissingKeyIteratorRetrieveInternalKeysMethod()
      return []
    }

    return this.#keyIterator?.retrieveInternalKeys(this.selectedAccounts, this.hdPathTemplate)
  }

  async setPage({
    page = this.page,
    networks,
    providers
  }: {
    page: number
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): Promise<void> {
    if (!this.isInitialized) return this.#throwNotInitialized()
    if (!this.#keyIterator) return this.#throwMissingKeyIterator()

    if (page <= 0) {
      return this.emitError({
        level: 'major',
        message:
          'Something went wrong with deriving the accounts. Please reload and try again. If the problem persists, contact support.',
        error: new Error('accountAdder: page must be a positive number')
      })
    }

    this.page = page
    this.#derivedAccounts = []
    this.#linkedAccounts = []
    this.accountsLoading = true
    this.emitUpdate()
    try {
      this.#derivedAccounts = await this.#deriveAccounts({ networks, providers })
    } catch (e: any) {
      this.emitError({
        message: 'Retrieving accounts was canceled or failed.',
        error: e?.message || 'accountAdder: failed to derive accounts',
        level: 'major'
      })
    }
    this.accountsLoading = false
    this.emitUpdate()
    this.#findAndSetLinkedAccounts({
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
        .map((acc) => acc.account),
      networks,
      providers
    })
  }

  /**
   * Triggers the process of adding accounts via the AccountAdder flow by
   * creating identity for the smart accounts (if needed) on the Relayer.
   * Then the `onAccountAdderSuccess` listener in the Main Controller gets
   * triggered, which uses the `readyToAdd...` properties to further set
   * the newly added accounts data (like preferences, keys and others)
   */
  async addAccounts(
    accounts: SelectedAccountForImport[] = [],
    readyToAddAccountPreferences: AccountPreferences = {},
    readyToAddKeys: ReadyToAddKeys = { internal: [], external: [] },
    readyToAddKeyPreferences: KeyPreferences = []
  ) {
    if (!this.isInitialized) return this.#throwNotInitialized()
    if (!this.#keyIterator) return this.#throwMissingKeyIterator()

    if (!accounts.length) {
      return this.emitError({
        level: 'minor',
        message:
          'Trying to add accounts, but no accounts are selected. Please select at least one account.',
        error: new Error(
          'accountAdder: requested method `addAccounts`, but the accounts param is empty'
        )
      })
    }

    this.addAccountsStatus = 'LOADING'
    this.emitUpdate()

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
        this.emitUpdate()
        return
      }
    }

    this.readyToAddAccounts = [
      ...accounts.map((x) => ({
        ...x.account,
        newlyCreated: newlyCreatedAccounts.includes(x.account.addr)
      }))
    ]
    this.readyToAddKeys = readyToAddKeys
    this.readyToAddKeyPreferences = readyToAddKeyPreferences
    this.readyToAddAccountPreferences = readyToAddAccountPreferences
    this.addAccountsStatus = 'SUCCESS'
    this.emitUpdate()

    // reset the addAccountsStatus in the next tick to ensure the FE receives the 'SUCCESS' state
    await wait(1)
    this.addAccountsStatus = 'INITIAL'
    this.emitUpdate()
  }

  async createAndAddEmailAccount(selectedAccount: SelectedAccountForImport) {
    const {
      account: { email },
      accountKeys: [recoveryKey]
    } = selectedAccount
    if (!this.isInitialized) return this.#throwNotInitialized()
    if (!this.#keyIterator) return this.#throwMissingKeyIterator()

    const keyPublicAddress: string = (await this.#keyIterator.retrieve([{ from: 0, to: 1 }]))[0]

    const emailSmartAccount = await getEmailAccount(
      {
        emailFrom: email!,
        secondaryKey: recoveryKey.addr
      },
      keyPublicAddress
    )

    await this.addAccounts([{ ...selectedAccount, account: { ...emailSmartAccount, email } }])
  }

  // updates the account adder state so the main ctrl receives the readyToAddAccounts
  // that should be added to the storage of the app
  async addExistingEmailAccounts(accounts: Account[]) {
    // There is no need to call the addAccounts method in order to add that
    // account to the relayer because this func will be called only for accounts returned
    // from relayer that only need to be stored in the storage of the app
    this.readyToAddAccounts = accounts
    this.addAccountsStatus = 'SUCCESS'
    this.emitUpdate()
  }

  async #deriveAccounts({
    networks,
    providers
  }: {
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): Promise<DerivedAccount[]> {
    // Should never happen, because before the #deriveAccounts method gets
    // called - there is a check if the #keyIterator exists.
    if (!this.#keyIterator) {
      console.error('accountAdder: missing keyIterator')
      return []
    }

    const accounts: DerivedAccountWithoutNetworkMeta[] = []

    const startIdx = (this.page - 1) * this.pageSize
    const endIdx = (this.page - 1) * this.pageSize + (this.pageSize - 1)

    // Combine the requests for all accounts in one call to the keyIterator.
    // That's optimization primarily focused on hardware wallets, to reduce the
    // number of calls to the hardware device. This is important, especially
    // for Trezor, because it fires a confirmation popup for each call.
    const combinedBasicAndSmartAccKeys = await this.#keyIterator.retrieve(
      [
        // Indices for the basic (EOA) accounts
        { from: startIdx, to: endIdx },
        // Indices for the smart accounts
        {
          from: startIdx + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET,
          to: endIdx + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
        }
      ],
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
      const account = getBasicAccount(smartAccKey)
      const indexWithOffset = slot - 1 + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
      accounts.push({ account, isLinked: false, slot, index: indexWithOffset })

      // Derive the Ambire (smart) account
      smartAccountsPromises.push(
        getSmartAccount([{ addr: smartAccKey, hash: dedicatedToOneSAPriv }])
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
      const account = getBasicAccount(basicAccKey)
      accounts.push({ account, isLinked: false, slot, index: slot - 1 })
    }

    const accountsWithNetworks = await this.#getAccountsUsedOnNetworks({
      accounts,
      networks,
      providers
    })

    return accountsWithNetworks
  }

  // inner func
  // eslint-disable-next-line class-methods-use-this
  async #getAccountsUsedOnNetworks({
    accounts,
    networks,
    providers
  }: {
    accounts: DerivedAccountWithoutNetworkMeta[]
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): Promise<DerivedAccount[]> {
    const accountsObj: { [key: Account['addr']]: DerivedAccount } = Object.fromEntries(
      accounts.map((a) => [a.account.addr, { ...a, account: { ...a.account, usedOnNetworks: [] } }])
    )

    const networkLookup: { [key: NetworkDescriptor['id']]: NetworkDescriptor } = {}
    networks.forEach((network) => {
      networkLookup[network.id] = network
    })

    const promises = Object.keys(providers).map(async (providerKey: NetworkId) => {
      const network = networkLookup[providerKey]
      if (network) {
        const accountState = await getAccountState(
          providers[providerKey],
          network,
          accounts.map((acc) => acc.account)
        ).catch(() => {
          const message = `Failed to determine if accounts are used on ${network.name}.`
          // Prevents toast spamming
          if (this.emittedErrors.find((err) => err.message === message)) return

          this.emitError({
            level: 'major',
            message,
            error: new Error(
              `accountAdder.#getAccountsUsedOnNetworks: failed to determine if accounts are used on ${network.name}`
            )
          })
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
      const networkIdsA = a.account.usedOnNetworks.map((network) => network.id)
      const networkIdsB = b.account.usedOnNetworks.map((network) => network.id)
      const networkIndexA = networks.findIndex((network) => networkIdsA.includes(network.id))
      const networkIndexB = networks.findIndex((network) => networkIdsB.includes(network.id))
      return networkIndexA - networkIndexB
    })

    return sortedAccountsWithNetworksArray
  }

  async #findAndSetLinkedAccounts({
    accounts,
    networks,
    providers
  }: {
    accounts: Account[]
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }) {
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
        ethers.getCreate2Address(factoryAddr, salt, ethers.keccak256(bytecode)).toLowerCase() !==
        addr.toLowerCase()
      if (isInvalidAddress) {
        const message = `The address ${addr} can't be verified to be a smart account address.`
        this.emitError({ level: 'minor', message, error: new Error(message) })

        return []
      }
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
            }
          },
          isLinked: true
        }
      ]
    })

    const linkedAccountsWithNetworks = await this.#getAccountsUsedOnNetworks({
      accounts: linkedAccounts as any,
      networks,
      providers
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
        'accountAdder: requested a method of the AccountAdder controller, but the controller was not initialized'
      )
    })
  }

  #throwMissingKeyIterator() {
    this.emitError({
      level: 'major',
      message:
        'Something went wrong with deriving the accounts. Please start the process again. If the problem persists, contact support.',
      error: new Error('accountAdder: missing keyIterator')
    })
  }

  #throwMissingKeyIteratorRetrieveInternalKeysMethod() {
    this.emitError({
      level: 'major',
      message:
        'Retrieving internal keys failed. Please try to start the process of selecting accounts again. If the problem persist, please contact support.',
      error: new Error('accountAdder: missing retrieveInternalKeys method')
    })
  }

  #throwMissingHdPath() {
    this.emitError({
      level: 'major',
      message:
        'The HD path template is missing. Please try to start the process of selecting accounts again. If the problem persist, please contact support.',
      error: new Error('accountAdder: missing hdPathTemplate')
    })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      // includes the getter in the stringified instance
      accountsOnPage: this.accountsOnPage,
      type: this.type,
      subType: this.subType
    }
  }
}

export default AccountAdderController
