import { ethers, JsonRpcProvider } from 'ethers'

import { PROXY_AMBIRE_ACCOUNT } from '../../consts/deploy'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { KeyIterator } from '../../interfaces/keyIterator'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import {
  getEmailAccount,
  getLegacyAccount,
  getSmartAccount,
  isAmbireV1LinkedAccount
} from '../../libs/account/account'
import { getAccountState } from '../../libs/accountState/accountState'
import EventEmitter from '../../libs/eventEmitter/eventEmitter'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import wait from '../../utils/wait'

const INITIAL_PAGE_INDEX = 1
const PAGE_SIZE = 5

type ExtendedAccount = Account & { usedOnNetworks: NetworkDescriptor[] }

type SelectedAccount = Account & { slot: number; eoaAddress: string; isLinked: boolean }

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

  // optional because there is default derivationPath for each keyIterator
  derivationPath?: string

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

  #calculatedAccounts: {
    account: ExtendedAccount
    isLinked: boolean
    slot: number
  }[] = []

  #linkedAccounts: { account: ExtendedAccount; isLinked: boolean }[] = []

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

  get accountsOnPage(): {
    account: ExtendedAccount
    isLinked: boolean
    slot: number
  }[] {
    const processedAccounts = this.#calculatedAccounts.flatMap((calculatedAccount) => {
      const associatedLinkedAccounts = this.#linkedAccounts.filter(
        (linkedAcc) =>
          !calculatedAccount.account.creation &&
          linkedAcc.account.associatedKeys.includes(calculatedAccount.account.addr)
      )

      const correspondingSmartAccount = this.#calculatedAccounts.find(
        (acc) => acc.account.creation !== null && acc.slot === calculatedAccount.slot
      )

      let accountsToReturn = []

      if (!calculatedAccount.account.creation) {
        accountsToReturn.push(calculatedAccount)

        const duplicate = associatedLinkedAccounts.find(
          (linkedAcc) => linkedAcc.account.addr === correspondingSmartAccount?.account?.addr
        )

        // The calculated smart account that matches the relayer's linked account
        // should not be displayed as linked account. Use this cycle to mark it.
        if (duplicate) duplicate.isLinked = false

        if (!duplicate && correspondingSmartAccount) {
          accountsToReturn.push(correspondingSmartAccount)
        }
      }

      accountsToReturn = accountsToReturn.concat(
        associatedLinkedAccounts.map((linkedAcc) => ({
          ...linkedAcc,
          slot: calculatedAccount.slot
        }))
      )

      return accountsToReturn
    })

    const unprocessedLinkedAccounts = this.#linkedAccounts
      .filter(
        (linkedAcc) =>
          !processedAccounts.find(
            (processedAcc) => processedAcc.account.addr === linkedAcc.account.addr
          )
      )
      .map((linkedAcc) => {
        const correspondingCalculatedAccount = this.#calculatedAccounts.find((calculatedAcc) =>
          linkedAcc.account.associatedKeys.includes(calculatedAcc.account.addr)
        )

        return {
          ...linkedAcc,
          // @ts-ignore the `correspondingCalculatedAccount` should always be found
          slot: correspondingCalculatedAccount.slot
        }
      })

    const mergedAccounts = [...processedAccounts, ...unprocessedLinkedAccounts]

    mergedAccounts.sort((a, b) => {
      const prioritizeAccountType = (item: any) => {
        if (!item.account.creation) return -1
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
    derivationPath
  }: {
    keyIterator: KeyIterator | null
    preselectedAccounts: Account[]
    page?: number
    pageSize?: number
    derivationPath?: string
  }): void {
    this.#keyIterator = keyIterator
    this.preselectedAccounts = preselectedAccounts
    this.page = page || INITIAL_PAGE_INDEX
    this.pageSize = pageSize || PAGE_SIZE
    this.derivationPath = derivationPath
    this.isInitialized = true

    this.emitUpdate()
  }

  reset() {
    this.#keyIterator = null
    this.preselectedAccounts = []
    this.selectedAccounts = []
    this.page = INITIAL_PAGE_INDEX
    this.pageSize = PAGE_SIZE
    this.derivationPath = undefined

    this.addAccountsStatus = 'INITIAL'
    this.readyToAddAccounts = []
    this.isInitialized = false

    this.emitUpdate()
  }

  setDerivationPath({
    path,
    networks,
    providers
  }: {
    path: string
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): void {
    this.derivationPath = path
    this.page = INITIAL_PAGE_INDEX
    this.emitUpdate()
    // get the first page with the new derivationPath
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

    const allAccountsOnThisSlot = this.accountsOnPage.filter(
      ({ slot }) => slot === accountOnPage.slot
    )

    const legacyAccountOnThisSlot = allAccountsOnThisSlot.find(({ account }) => !account.creation)

    if (!legacyAccountOnThisSlot)
      return this.emitError({
        level: 'major',
        message: `Selecting ${_account.addr} account failed because some of the details for this account are missing. Please try again or contact support if the problem persists.`,
        error: new Error(
          `The legacy account for the ${_account.addr} account was not found on this slot.`
        )
      })

    this.selectedAccounts.push({
      ..._account,
      eoaAddress: legacyAccountOnThisSlot?.account.addr,
      slot: accountOnPage.slot,
      isLinked: accountOnPage.isLinked
    })
    this.emitUpdate()
  }

  async deselectAccount(account: Account) {
    const accIdx = this.selectedAccounts.findIndex((acc) => acc.addr === account.addr)
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
          'Something went wrong with calculating the accounts. Please reload and try again. If the problem persists, contact support.',
        error: new Error('accountAdder: page must be a positive number')
      })
    }

    this.page = page
    this.#calculatedAccounts = []
    this.#linkedAccounts = []
    this.accountsLoading = true
    this.emitUpdate()
    const calculatedAccounts = await this.#calculateAccounts({ networks, providers })
    this.#calculatedAccounts = calculatedAccounts
    this.accountsLoading = false
    this.emitUpdate()
    this.#searchForLinkedAccounts({
      accounts: this.#calculatedAccounts
        .filter((acc) => !acc.account.creation)
        .map((acc) => acc.account),
      networks,
      providers
    })
  }

  async addAccounts(accounts: Account[] = []) {
    if (!this.isInitialized) {
      return this.emitError({
        level: 'major',
        message:
          'Something went wrong with calculating the accounts. Please start the process again. If the problem persists, contact support.',
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

    const accountsToAddOnRelayer = accounts
      // Identity only for the smart accounts must be created on the Relayer
      .filter((acc) => acc.creation)
      // Skip creating identity for Ambire v1 smart accounts
      .filter((acc) => !isAmbireV1LinkedAccount(acc.creation?.factoryAddr))

    if (accountsToAddOnRelayer.length) {
      const body = accountsToAddOnRelayer.map((acc) => ({
        addr: acc.addr,
        associatedKeys: acc.privileges,
        creation: {
          factoryAddr: acc.creation!.factoryAddr,
          salt: acc.creation!.salt,
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

    this.readyToAddAccounts = [...accounts]
    this.addAccountsStatus = 'SUCCESS'
    this.emitUpdate()

    // reset the addAccountsStatus in the next tick to ensure the FE receives the 'SUCCESS' state
    await wait(1)
    this.addAccountsStatus = 'INITIAL'
    this.emitUpdate()
  }

  async addEmailAccount(email: string, recoveryKey: string) {
    if (!this.isInitialized) {
      this.emitError({
        level: 'major',
        message:
          'Something went wrong with calculating the accounts. Please start the process again. If the problem persists, contact support.',
        error: new Error(
          'accountAdder: requested method `#calculateAccounts`, but the AccountAdder is not initialized'
        )
      })
      return
    }

    if (!this.#keyIterator) {
      this.emitError({
        level: 'major',
        message:
          'Something went wrong with calculating the accounts. Please start the process again. If the problem persists, contact support.',
        error: new Error(
          'accountAdder: requested method `#calculateAccounts`, but keyIterator is not initialized'
        )
      })
      return
    }

    const key: string = (await this.#keyIterator.retrieve(0, 1))[0]

    const priv = {
      addr: key,
      hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
    }

    const emailSmartAccount = await getEmailAccount(
      {
        emailFrom: email,
        secondaryKey: recoveryKey
      },
      [priv]
    )

    await this.addAccounts([emailSmartAccount])
  }

  async #calculateAccounts({
    networks,
    providers
  }: {
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): Promise<
    {
      account: ExtendedAccount
      isLinked: boolean
      slot: number
    }[]
  > {
    if (!this.isInitialized) {
      this.emitError({
        level: 'major',
        message:
          'Something went wrong with calculating the accounts. Please start the process again. If the problem persists, contact support.',
        error: new Error(
          'accountAdder: requested method `#calculateAccounts`, but the AccountAdder is not initialized'
        )
      })
      return []
    }

    if (!this.#keyIterator) {
      this.emitError({
        level: 'major',
        message:
          'Something went wrong with calculating the accounts. Please start the process again. If the problem persists, contact support.',
        error: new Error(
          'accountAdder: requested method `#calculateAccounts`, but keyIterator is not initialized'
        )
      })
      return []
    }

    const accounts: { account: Account; isLinked: boolean; slot: number }[] = []

    const startIdx = (this.page - 1) * this.pageSize
    const endIdx = (this.page - 1) * this.pageSize + (this.pageSize - 1)

    const keys = this.derivationPath
      ? await this.#keyIterator.retrieve(startIdx, endIdx)
      : await this.#keyIterator.retrieve(startIdx, endIdx, this.derivationPath)

    // Replace the parallel getKeys with foreach to prevent issues with Ledger,
    // which can only handle one request at a time.
    // eslint-disable-next-line no-restricted-syntax
    for (const [index, key] of keys.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const priv = {
        addr: key,
        hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
      }
      // eslint-disable-next-line no-await-in-loop
      const smartAccount = await getSmartAccount([priv])
      accounts.push({ account: getLegacyAccount(key), isLinked: false, slot: index + 1 })
      accounts.push({ account: smartAccount, isLinked: false, slot: index + 1 })
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
    accounts: { account: Account; isLinked: boolean; slot: number }[]
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): Promise<{ account: ExtendedAccount; isLinked: boolean; slot: number }[]> {
    const accountsObj: {
      [key: string]: { account: ExtendedAccount; isLinked: boolean; slot: number }
    } = Object.fromEntries(
      accounts.map((a) => [a.account.addr, { ...a, account: { ...a.account, usedOnNetworks: [] } }])
    )

    const networkLookup: { [key: string]: NetworkDescriptor } = {}
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
          if (acc.balance > BigInt(0) || acc.nonce > BigInt(0)) {
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

  async #searchForLinkedAccounts({
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
    const linkedAccounts: ({ account: ExtendedAccount; isLinked: boolean } | null)[] = Object.keys(
      data.accounts
    )
      .map((addr: any) => {
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

          return null
        }

        const { factoryAddr, bytecode, salt, associatedKeys } = data.accounts[addr]
        // Checks whether the account.addr matches the addr generated from the
        // factory. Should never happen, but could be a possible attack vector.
        const isInvalidAddress =
          ethers.getCreate2Address(factoryAddr, salt, ethers.keccak256(bytecode)).toLowerCase() !==
          addr.toLowerCase()
        if (isInvalidAddress) {
          this.emitError({
            level: 'minor',
            message: `The address ${addr} is not generated from the Ambire factory.`,
            error: new Error(`The address ${addr} is not generated from the Ambire factory.`)
          })

          return null
        }

        return {
          account: {
            addr,
            label: '',
            pfp: '',
            associatedKeys: Object.keys(associatedKeys),
            creation: {
              factoryAddr,
              bytecode,
              salt
            }
          } as ExtendedAccount,
          isLinked: true
        }
      })
      .filter((acc) => acc !== null)

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
