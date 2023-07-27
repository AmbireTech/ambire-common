import { getAddress, JsonRpcProvider } from 'ethers'
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

  #calculatedAccounts: { account: ExtendedAccount; type: 'legacy' | 'smart'; slot: number }[] = []

  #linkedAccounts: { account: ExtendedAccount; type: 'legacy'; slot: number }[] = []

  constructor(_storage: Storage, _relayerUrl: string) {
    super()
    this.storage = _storage
    this.#callRelayer = relayerCall.bind({ url: _relayerUrl })
  }

  get accountsOnPage(): {
    account: ExtendedAccount
    type: 'linked' | 'legacy' | 'smart'
    slot: number
  }[] {
    // TODO:
    return this.#calculatedAccounts
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
    const calculatedAccounts = await this.#calculateAccounts({ networks, providers })
    this.#calculatedAccounts = calculatedAccounts
    this.emitUpdate()
    const linkedAccounts = await this.#searchForLinkedAccounts(
      this.#calculatedAccounts.map((acc) => ({
        ...acc.account
      }))
    )
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
      type: 'legacy' | 'smart'
      slot: number
    }[]
  > {
    if (!this.#keyIterator || !this.isInitialized) {
      throw new Error('accountAdder: keyIterator not initialized')
    }

    const accounts: { account: Account; type: 'legacy' | 'smart'; slot: number }[] = []

    const startIdx = (this.page - 1) * this.pageSize
    const endIdx = (this.page - 1) * this.pageSize + (this.pageSize - 1)

    const keys = this.derivationPath
      ? await this.#keyIterator.retrieve(startIdx, endIdx)
      : await this.#keyIterator.retrieve(startIdx, endIdx, this.derivationPath)

    // eslint-disable-next-line no-restricted-syntax
    for (const [index, key] of keys.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const smartAccount = await getSmartAccount(key)
      accounts.push({ account: getLegacyAccount(key), type: 'legacy', slot: index + 1 })
      accounts.push({ account: smartAccount, type: 'smart', slot: index + 1 })
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
    accounts: { account: Account; type: 'legacy' | 'smart'; slot: number }[]
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): Promise<{ account: ExtendedAccount; type: 'legacy' | 'smart'; slot: number }[]> {
    const accountsObj: {
      [key: string]: { account: ExtendedAccount; type: 'legacy' | 'smart'; slot: number }
    } = Object.fromEntries(
      accounts.map((a) => [a.account.addr, { ...a, account: { ...a.account, usedOnNetworks: [] } }])
    )

    Object.keys(providers).forEach(async (providerKey: NetworkId) => {
      const network = networks.find((n) => n.id === providerKey) as NetworkDescriptor
      if (network) {
        const accountState = await getAccountState(
          providers[providerKey],
          network,
          accounts.map((acc: { account: Account; type: 'legacy' | 'smart'; slot: number }) => ({
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

    return Object.values(accountsObj)
  }

  async #searchForLinkedAccounts(accounts: Account[]) {
    this.linkedAccountsLoading = true
    this.emitUpdate()
    await Promise.all(
      accounts.map(async (acc: Account) => {
        const { status, success, ...rest } = await this.#callRelayer(
          `/identity/any/by-owner/${acc.addr}?includeFormerlyOwned=true`
        )
        const privEntries = Object.entries(await rest)
        console.log('privEntries', privEntries)
        privEntries.forEach(([entryId, _]) => {
          // this.#linkedAccounts.push({ [getAddress(acc.addr)]: entryId })
        })
      })
    ).then((linkedAccs) => {
      console.log('linkedAccs', linkedAccs)
      this.linkedAccountsLoading = false
      this.emitUpdate()
    })
  }
}

export default AccountAdderController
