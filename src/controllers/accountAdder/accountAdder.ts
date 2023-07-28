/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { JsonRpcProvider } from 'ethers'
import { KeyIterator } from 'interfaces/keyIterator'
import { NetworkDescriptor, NetworkId } from 'interfaces/networkDescriptor'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { Storage } from '../../interfaces/storage'
import { getLegacyAccount, getSmartAccount } from '../../libs/account/account'
import { getAccountState } from '../../libs/accountState/accountState'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import EventEmitter from '../eventEmitter'

const INITIAL_PAGE_INDEX = 1
const PAGE_SIZE = 5

type ExtendedAccount = Account & { usedOnNetworks: NetworkDescriptor[] }

type AccountType = 'legacy' | 'smart' | 'linked'
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

  accountsLoading: boolean = false

  linkedAccountsLoading: boolean = false

  #calculatedAccounts: {
    account: ExtendedAccount
    type: AccountType
    slot: number
  }[] = []

  #linkedAccounts: { account: ExtendedAccount; type: AccountType }[] = []

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
    type: AccountType
    slot: number
  }[] {
    const mergedAccounts: {
      account: ExtendedAccount
      type: AccountType
      slot: number
    }[] = []

    this.#calculatedAccounts.forEach((calculatedAccount) => {
      if (calculatedAccount.type === 'legacy') {
        mergedAccounts.push(calculatedAccount)
      }

      if (calculatedAccount.type === 'smart') {
        const smartLinkedAccount = this.#linkedAccounts.find(
          (linkedAcc) => linkedAcc.account.addr === calculatedAccount.account.addr
        )

        if (smartLinkedAccount) {
          const uniqueKeys = new Set([
            ...smartLinkedAccount.account.associatedKeys,
            ...calculatedAccount.account.associatedKeys
          ])
          smartLinkedAccount.account.associatedKeys = Array.from(uniqueKeys)
        } else {
          mergedAccounts.push(calculatedAccount)
          this.#linkedAccounts.forEach((linked) => {
            if (linked.account.associatedKeys.includes(calculatedAccount.account.addr)) {
              mergedAccounts.push({
                ...linked,
                slot: calculatedAccount.slot
              })
            }
          })
        }
      }
    })

    mergedAccounts.sort((a, b) => {
      if (a.slot !== b.slot) return a.slot - b.slot

      const typeOrder = { legacy: 0, smart: 1, linked: 2 }
      return typeOrder[a.type] - typeOrder[b.type]
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
    this.selectedAccounts = []
    this.page = page || INITIAL_PAGE_INDEX
    this.pageSize = pageSize || PAGE_SIZE
    this.derivationPath = derivationPath
    this.isInitialized = true
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
    const calculatedAccounts = await this.#calculateAccounts({ networks, providers })
    this.#calculatedAccounts = calculatedAccounts
    this.accountsLoading = false
    this.emitUpdate()
    this.#searchForLinkedAccounts({
      accounts: this.#calculatedAccounts
        .filter((acc) => acc.type === 'smart')
        .map((acc) => acc.account),
      networks,
      providers
    })
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
      type: AccountType
      slot: number
    }[]
  > {
    if (!this.#keyIterator || !this.isInitialized) {
      throw new Error('accountAdder: keyIterator not initialized')
    }

    const accounts: { account: Account; type: AccountType; slot: number }[] = []

    const startIdx = (this.page - 1) * this.pageSize
    const endIdx = (this.page - 1) * this.pageSize + (this.pageSize - 1)

    const keys = this.derivationPath
      ? await this.#keyIterator.retrieve(startIdx, endIdx)
      : await this.#keyIterator.retrieve(startIdx, endIdx, this.derivationPath)

    const smartAccountPromises = keys.map((key, index) => getSmartAccount(key))

    const smartAccounts = await Promise.all(smartAccountPromises)

    keys.forEach((key, index) => {
      accounts.push({ account: getLegacyAccount(key), type: 'legacy', slot: index + 1 })
      accounts.push({ account: smartAccounts[index], type: 'smart', slot: index + 1 })
    })

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
    accounts: { account: Account; type: AccountType; slot: number }[]
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): Promise<{ account: ExtendedAccount; type: AccountType; slot: number }[]> {
    const accountsObj: {
      [key: string]: { account: ExtendedAccount; type: AccountType; slot: number }
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

    return Object.values(accountsObj)
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

    async function getLinkedAccounts(
      entries: any
    ): Promise<{ account: Account; type: AccountType }[]> {
      const linkedAccounts: { account: Account; type: AccountType }[] = []
      for (const [linkedAddress] of entries) {
        const linkedSmartAccount: Account = await getSmartAccount(linkedAddress)
        linkedAccounts.push({ account: linkedSmartAccount, type: 'linked' })
      }
      return linkedAccounts
    }

    const fetchLinkedAccountsPromises = accounts.map(async (acc: Account) => {
      const { status, success, ...rest } = await this.#callRelayer(
        `/identity/any/by-owner/${acc.addr}?includeFormerlyOwned=true`
      )
      const privEntries = Object.entries(await rest)
      return getLinkedAccounts(privEntries)
    })

    const linkedAccountsArrays: { account: Account; type: AccountType }[][] = await Promise.all(
      fetchLinkedAccountsPromises
    )

    const linkedAccountsWithNetworks = await this.#getAccountsUsedOnNetworks({
      accounts: linkedAccountsArrays.flat() as any,
      networks,
      providers
    })
    this.#linkedAccounts = linkedAccountsWithNetworks
    this.linkedAccountsLoading = false
    this.emitUpdate()
  }
}

export default AccountAdderController
