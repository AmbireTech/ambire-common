import { ethers, JsonRpcProvider } from 'ethers'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { KeyIterator } from '../../interfaces/keyIterator'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { getLegacyAccount, getSmartAccount } from '../../libs/account/account'
import { getAccountState } from '../../libs/accountState/accountState'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import EventEmitter from '../eventEmitter'

const INITIAL_PAGE_INDEX = 1
const PAGE_SIZE = 5

type ExtendedAccount = Account & { usedOnNetworks: NetworkDescriptor[] }

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

  #keyIterator?: KeyIterator

  // optional because there is default derivationPath for each keyIterator
  derivationPath?: string

  isInitialized: boolean = false

  // This is only the index of the current page
  page: number = INITIAL_PAGE_INDEX

  pageSize: number = PAGE_SIZE

  selectedAccounts: Account[] = []

  preselectedAccounts: Account[] = []

  // Smart accounts which identity is created on the Relayer, and are ready
  // to be added to the user's account list by the Main Controller
  readyToAddAccounts: Account[] = []

  // Identity for the smart accounts must be created on the Relayer, this
  // represents the status of the operation, needed managing UI state
  addAccountsStatus:
    | { type: 'PENDING' }
    | { type: 'SUCCESS' }
    | { type: 'ERROR'; message: string }
    | { type: 'INITIAL' } = { type: 'INITIAL' }

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
          // The `correspondingCalculatedAccount` should always be found, so -1
          // is a fallback value that should never happen.
          slot: correspondingCalculatedAccount ? correspondingCalculatedAccount.slot : -1
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
    keyIterator: KeyIterator
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
    this.#keyIterator = undefined
    this.preselectedAccounts = []
    this.selectedAccounts = []
    this.page = INITIAL_PAGE_INDEX
    this.pageSize = PAGE_SIZE
    this.derivationPath = undefined

    this.addAccountsStatus = { type: 'INITIAL' }
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

  selectAccount(account: Account) {
    this.selectedAccounts.push(account)
    this.emitUpdate()
  }

  async deselectAccount(account: Account) {
    const accIdx = this.selectedAccounts.findIndex((acc) => acc.addr === account.addr)
    const accPreselectedIdx = this.preselectedAccounts.findIndex((acc) => acc.addr === account.addr)

    if (accIdx !== -1 && accPreselectedIdx === -1) {
      this.selectedAccounts = this.selectedAccounts.filter((_, i) => i !== accIdx)
      this.emitUpdate()
    } else if (accPreselectedIdx !== -1) {
      throw new Error('accountAdder: a preselected account cannot be deselected')
    } else {
      throw new Error('accountAdder: account not found. Cannot deselect.')
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
      throw new Error('accountAdder: page must be a positive number')
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
      // TODO: Handle the error in a way that the foreground process can catch it
      throw new Error('Requested method `addAccounts`, but the AccountAdder is not initialized')
    }

    if (!accounts.length) return

    this.addAccountsStatus = { type: 'PENDING' }
    this.emitUpdate()

    // Identity only for the smart accounts must be created on the Relayer
    const accountsToAddOnRelayer = accounts.filter((acc) => acc.creation)

    if (accountsToAddOnRelayer.length) {
      const body = accountsToAddOnRelayer.map((acc) => ({
        addr: acc.addr,
        associatedKeys: acc.associatedKeys,
        creation: {
          factoryAddr: acc.creation!.factoryAddr,
          salt: acc.creation!.salt
        }
      }))

      try {
        const res = await this.#callRelayer('/v2/identity/create-multiple', 'POST', {
          accounts: body
        })

        if (!res.success)
          throw new Error(
            res?.message ||
              'Error when adding accounts on the Ambire Relayer. Please try again later or contact support if the problem persists.'
          )
      } catch (e: any) {
        this.addAccountsStatus = { type: 'ERROR', message: e?.message }
        this.emitUpdate()
        return
      }
    }

    this.readyToAddAccounts = [...accounts]
    this.addAccountsStatus = { type: 'SUCCESS' }
    this.emitUpdate()
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
      // TODO: Handle the error in a way that the foreground process can catch it
      throw new Error(
        'Requested method `#calculateAccounts`, but the AccountAdder is not initialized'
      )
    }

    if (!this.#keyIterator) {
      // TODO: Handle the error in a way that the foreground process can catch it
      throw new Error('Requested method `#calculateAccounts`, but keyIterator is not initialized')
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
      const smartAccount = await getSmartAccount(key)
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
          accounts.map((acc) => ({
            ...acc.account,
            creation: {
              factoryAddr: '0x0000000000000000000000000000000000000000',
              bytecode: '0x00',
              salt: '0x0'
            }
          }))
        )

        accountState.forEach((acc: AccountOnchainState) => {
          if (acc.balance > BigInt(0) || acc.nonce > 0) {
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
    this.linkedAccountsLoading = true
    this.emitUpdate()

    const keys = accounts.map((acc) => `keys[]=${acc.addr}`).join('&')
    const url = `/v2/account-by-key/linked/accounts?${keys}`

    const { data } = await this.#callRelayer(url)
    const linkedAccounts: { account: ExtendedAccount; isLinked: boolean }[] = Object.keys(
      data.accounts
    ).map((addr: any) => {
      const { factoryAddr, bytecode, salt, associatedKeys } = data.accounts[addr]
      // checks whether the account.addr matches the addr generated from the factory
      if (
        ethers.getCreate2Address(factoryAddr, salt, ethers.keccak256(bytecode)).toLowerCase() !==
        addr.toLowerCase()
      ) {
        throw new Error('accountAddr: address not generated from that factory')
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
