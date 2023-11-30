import { ethers, JsonRpcProvider } from 'ethers'

import { schemas } from '../../libs/schemaValidation/validateScehmas'
import { PROXY_AMBIRE_ACCOUNT } from '../../consts/deploy'
import {
  HD_PATH_TEMPLATE_TYPE,
  SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
} from '../../consts/derivation'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { KeyIterator } from '../../interfaces/keyIterator'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import {
  getLegacyAccount,
  getSmartAccount,
  isAmbireV1LinkedAccount,
  isDerivedForSmartAccountKeyOnly,
  isSmartAccount
} from '../../libs/account/account'
import { getAccountState } from '../../libs/accountState/accountState'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter'

const INITIAL_PAGE_INDEX = 1
const PAGE_SIZE = 5

type AccountWithNetworkMeta = Account & { usedOnNetworks: NetworkDescriptor[] }

type AccountDerivationMeta = {
  slot: number // the iteration on which the account is derived, starting from 1
  index: number // the derivation index of the <account> in the slot, starting from 0
  isLinked: boolean // linked accounts are also smart accounts, so use a flag to differentiate
}

/**
 * The account that the user has actively chosen (selected) via the app UI.
 * It's always one of the visible accounts returned by the accountsOnPage().
 * Could be either a legacy (EOA) account, a smart account or a linked account.
 */
type SelectedAccount = AccountDerivationMeta & { account: Account; accountKeyAddr: Account['addr'] }

/**
 * The account that is derived programmatically and internally by Ambire.
 * Could be either a legacy (EOA) account, a derived with custom derivation
 * legacy (EOA) account (used for smart account key only) or a smart account.
 */
type DerivedAccount = AccountDerivationMeta & { account: AccountWithNetworkMeta }
// Sub-type, used during intermediate step during the deriving accounts process
type DerivedAccountWithoutNetworkMeta = Omit<DerivedAccount, 'account'> & { account: Account }

/**
 * Account Adder Controller
 * is responsible for listing accounts that can be selected for adding, and for
 * adding (creating) identity for the smart accounts (if needed) on the Relayer.
 * It uses a KeyIterator interface allow iterating all the keys in a specific
 * underlying store such as a hardware device or an object holding a seed.
 */
export class AccountAdderController extends EventEmitter {
  #callRelayer: Function

  storage: Storage

  #keyIterator?: KeyIterator | null

  hdPathTemplate?: HD_PATH_TEMPLATE_TYPE

  isInitialized: boolean = false

  // This is only the index of the current page
  page: number = INITIAL_PAGE_INDEX

  pageSize: number = PAGE_SIZE

  selectedAccounts: SelectedAccount[] = []

  preselectedAccounts: Account[] = []

  // Smart accounts which identity is created on the Relayer, and are ready
  // to be added to the user's account list by the Main Controller
  readyToAddAccounts: Account[] = []

  // Identity for the smart accounts must be created on the Relayer, this
  // represents the status of the operation, needed managing UI state
  addAccountsStatus: 'LOADING' | 'SUCCESS' | 'INITIAL' = 'INITIAL'

  accountsLoading: boolean = false

  linkedAccountsLoading: boolean = false

  #derivedAccounts: DerivedAccount[] = []

  #linkedAccounts: { account: AccountWithNetworkMeta; isLinked: boolean }[] = []

  constructor({
    storage,
    relayerUrl,
    fetch
  }: {
    storage: Storage
    relayerUrl: string
    fetch: Function
  }) {
    super()
    this.storage = storage
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
  }

  get accountsOnPage(): DerivedAccount[] {
    const processedAccounts = this.#derivedAccounts
      // The displayed (visible) accounts on page should not include the derived
      // EOA (legacy) accounts only used as smart account keys, they should not
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

        let accountsToReturn = []

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

          return []
        }

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

    return mergedAccounts
  }

  init({
    keyIterator,
    preselectedAccounts,
    page,
    pageSize,
    hdPathTemplate
  }: {
    keyIterator: KeyIterator | null
    preselectedAccounts: Account[]
    page?: number
    pageSize?: number
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE
  }): void {
    this.#keyIterator = keyIterator
    this.preselectedAccounts = preselectedAccounts
    this.page = page || INITIAL_PAGE_INDEX
    this.pageSize = pageSize || PAGE_SIZE
    this.hdPathTemplate = hdPathTemplate
    this.isInitialized = true

    this.emitUpdate()
  }

  reset() {
    this.#keyIterator = null
    this.preselectedAccounts = []
    this.selectedAccounts = []
    this.page = INITIAL_PAGE_INDEX
    this.pageSize = PAGE_SIZE
    this.hdPathTemplate = undefined

    this.addAccountsStatus = 'INITIAL'
    this.readyToAddAccounts = []
    this.isInitialized = false

    this.emitUpdate()
  }

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
    this.page = INITIAL_PAGE_INDEX
    this.emitUpdate()
    // get the first page with the new hdPathTemplate (derivation)
    this.setPage({ page: INITIAL_PAGE_INDEX, networks, providers })
  }

  selectAccount(_account: Account) {
    const accountOnPage = this.accountsOnPage.find(
      (accOnPage) => accOnPage.account.addr === _account.addr
    )

    if (!accountOnPage)
      return this.emitError({
        level: 'major',
        message: `Selecting ${_account.addr} account failed because the details for this account are missing. Please try again or contact support if the problem persists.`,
        error: new Error(
          `Trying to select ${_account.addr} account, but this account was not found in the accountsOnPage.`
        )
      })

    const allAccountsOnThisSlot = this.#derivedAccounts.filter(
      ({ slot }) => slot === accountOnPage.slot
    )

    const accountKey = isSmartAccount(accountOnPage.account)
      ? // The key of the smart account is the EOA (legacy) account derived on the
        // same slot, but with the `SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET` offset.
        allAccountsOnThisSlot.find(({ index }) => isDerivedForSmartAccountKeyOnly(index))
      : // The key of the legacy account is the legacy account itself.
        accountOnPage

    if (!accountKey)
      return this.emitError({
        level: 'major',
        message: `Selecting ${_account.addr} account failed because some of the details for this account are missing. Please try again or contact support if the problem persists.`,
        error: new Error(
          `The legacy account for the ${_account.addr} account was not found on this slot.`
        )
      })

    this.selectedAccounts.push({
      account: _account,
      accountKeyAddr: accountKey.account.addr,
      slot: accountOnPage.slot,
      isLinked: accountOnPage.isLinked,
      index: accountKey.index
    })
    this.emitUpdate()
  }

  async deselectAccount(account: Account) {
    const accIdx = this.selectedAccounts.findIndex((x) => x.account.addr === account.addr)
    const accPreselectedIdx = this.preselectedAccounts.findIndex((acc) => acc.addr === account.addr)

    if (accIdx !== -1 && accPreselectedIdx === -1) {
      this.selectedAccounts = this.selectedAccounts.filter((_, i) => i !== accIdx)
      this.emitUpdate()
    } else if (accPreselectedIdx !== -1) {
      return this.emitError({
        level: 'major',
        message: 'This account cannot be deselected. Please reload and try again.',
        error: new Error('accountAdder: a preselected account cannot be deselected')
      })
    } else {
      return this.emitError({
        level: 'major',
        message: 'This account cannot be deselected. Please reload and try again.',
        error: new Error('accountAdder: account not found. Cannot deselect.')
      })
    }
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
    this.#derivedAccounts = await this.#deriveAccounts({ networks, providers })
    this.accountsLoading = false
    this.emitUpdate()
    this.#findAndSetLinkedAccounts({
      accounts: this.#derivedAccounts
        .filter(
          (acc) =>
            // Search for linked accounts to the legacy (EOA) accounts only.
            // Searching for linked accounts to another Ambire smart accounts
            // is a feature that Ambire is yet to support.
            !isSmartAccount(acc.account) &&
            // Skip searching for linked accounts to the derived EOA (legacy)
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

  async addAccounts(accounts: SelectedAccount[] = []) {
    if (!this.isInitialized) {
      return this.emitError({
        level: 'major',
        message:
          'Something went wrong with deriving the accounts. Please start the process again. If the problem persists, contact support.',
        error: new Error(
          'accountAdder: requested method `addAccounts`, but the AccountAdder is not initialized'
        )
      })
    }

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

    const accountsToAddOnRelayer: SelectedAccount[] = accounts
      // Identity only for the smart accounts must be created on the Relayer
      .filter((x) => isSmartAccount(x.account))
      // Skip creating identity for Ambire v1 smart accounts
      .filter((x) => !isAmbireV1LinkedAccount(x.account.creation?.factoryAddr))

    if (accountsToAddOnRelayer.length) {
      const body = accountsToAddOnRelayer.map(({ account }) => ({
        addr: account.addr,
        associatedKeys: account.associatedKeys.map((key) => [
          ethers.getAddress(key), // the Relayer expects checksumed address
          // Handle special priv hashes at a later stage, when (if) needed
          '0x0000000000000000000000000000000000000000000000000000000000000001'
        ]),
        creation: {
          factoryAddr: account.creation!.factoryAddr,
          salt: account.creation!.salt,
          baseIdentityAddr: PROXY_AMBIRE_ACCOUNT
        }
      }))

      try {
        // doesn't need aditional schema validation
        const res = await this.#callRelayer('/v2/identity/create-multiple', 'POST', {
          accounts: body
        })

        if (!res.success) {
          throw new Error(res?.message || 'No response received from the Ambire Relayer.')
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

    this.readyToAddAccounts = [...accounts.map((x) => x.account)]
    this.addAccountsStatus = 'SUCCESS'
    this.emitUpdate()

    // reset the addAccountsStatus in the next tick to ensure the FE receives the 'SUCCESS' state
    await wait(1)
    this.addAccountsStatus = 'INITIAL'
    this.emitUpdate()
  }

  async #deriveAccounts({
    networks,
    providers
  }: {
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): Promise<DerivedAccount[]> {
    if (!this.isInitialized) {
      this.emitError({
        level: 'major',
        message:
          'Something went wrong with deriving the accounts. Please start the process again. If the problem persists, contact support.',
        error: new Error(
          'accountAdder: requested method `#deriveAccounts`, but the AccountAdder is not initialized'
        )
      })
      return []
    }

    if (!this.#keyIterator) {
      this.emitError({
        level: 'major',
        message:
          'Something went wrong with deriving the accounts. Please start the process again. If the problem persists, contact support.',
        error: new Error(
          'accountAdder: requested method `#deriveAccounts`, but keyIterator is not initialized'
        )
      })
      return []
    }

    const accounts: DerivedAccountWithoutNetworkMeta[] = []

    const startIdx = (this.page - 1) * this.pageSize
    const endIdx = (this.page - 1) * this.pageSize + (this.pageSize - 1)

    const legacyAccKeys = await this.#keyIterator.retrieve(startIdx, endIdx, this.hdPathTemplate)
    const smartAccKeys = await this.#keyIterator.retrieve(
      startIdx + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET,
      endIdx + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET,
      this.hdPathTemplate
    )

    const smartAccountsPromises: Promise<DerivedAccountWithoutNetworkMeta>[] = []
    // Replace the parallel getKeys with foreach to prevent issues with Ledger,
    // which can only handle one request at a time.
    // eslint-disable-next-line no-restricted-syntax
    for (const [index, smartAccKey] of smartAccKeys.entries()) {
      const slot = startIdx + (index + 1)

      // The derived EOA (legacy) account which is the key for the smart account
      const account = getLegacyAccount(smartAccKey)
      const indexWithOffset = slot - 1 + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
      accounts.push({ account, isLinked: false, slot, index: indexWithOffset })

      // Derive the Ambire (smart) account
      smartAccountsPromises.push(
        getSmartAccount(smartAccKey).then((smartAccount) => {
          return { account: smartAccount, isLinked: false, slot, index: slot - 1 }
        })
      )
    }

    const smartAccounts = await Promise.all(smartAccountsPromises)
    accounts.push(...smartAccounts)

    // eslint-disable-next-line no-restricted-syntax
    for (const [index, legacyAccKey] of legacyAccKeys.entries()) {
      const slot = startIdx + (index + 1)

      // The EOA (legacy) account on this slot
      const account = getLegacyAccount(legacyAccKey)
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
        )

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
    const isValid = schemas.RelayerResponseLinkedAccount(data)
    if (!isValid) {
      this.emitError({
        level: 'minor',
        message: 'Error to fetch identities from the relayer, please contact support.',
        error: new Error(schemas.RelayerResponseLinkedAccount.errors)
      })
      return
    }
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

    this.linkedAccountsLoading = false
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      accountsOnPage: this.accountsOnPage // includes the getter in the stringified instance
    }
  }
}

export default AccountAdderController
