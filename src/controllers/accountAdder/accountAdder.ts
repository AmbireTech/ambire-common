import { getAddress, JsonRpcProvider } from 'ethers'
import { KeyIterator } from 'interfaces/keyIterator'
import { NetworkDescriptor, NetworkId } from 'interfaces/networkDescriptor'

import { Account } from '../../interfaces/account'
import { Storage } from '../../interfaces/storage'
import { getLegacyAccount, getSmartAccount } from '../../libs/account/account'
import { getAccountState } from '../../libs/accountState/accountState'
import { relayerCall } from '../../libs/relayerCall/relayerCall'

const PAGE_SIZE = 5

type ExtendedAccount = Account & { usedOnNetworks: NetworkDescriptor[] }
export class AccountAdder {
  private callRelayer: Function

  storage: Storage

  #keyIterator?: KeyIterator

  // optional because there is default derivationPath for each keyIterator
  derivationPath?: string

  isReady: boolean = false

  page: number = 1

  pageSize: number = PAGE_SIZE

  selectedAccounts: Account[] = []

  preselectedAccounts: Account[] = []

  relayerUrl: string

  constructor(_storage: Storage, _relayerUrl: string) {
    this.storage = _storage
    this.relayerUrl = _relayerUrl
    this.callRelayer = relayerCall.bind({ url: this.relayerUrl })
  }

  init({
    _keyIterator,
    _preselectedAccounts,
    _page,
    _pageSize,
    _derivationPath
  }: {
    _keyIterator: KeyIterator
    _preselectedAccounts: Account[]
    _page?: number
    _pageSize?: number
    _derivationPath?: string
  }): void {
    this.#keyIterator = _keyIterator
    this.preselectedAccounts = _preselectedAccounts
    this.selectedAccounts = []
    this.page = _page || 1
    this.pageSize = _pageSize || PAGE_SIZE
    this.derivationPath = _derivationPath
    this.isReady = true
  }

  // inner func. When getting accounts call getPage instead
  async iterateAccounts({
    networks,
    providers
  }: {
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): Promise<ExtendedAccount[]> {
    if (!this.#keyIterator) {
      throw new Error('accountAdder: keyIterator not initialized')
    }

    const accounts: Account[] = []

    const startIdx = (this.page - 1) * PAGE_SIZE
    const endIdx = (this.page - 1) * PAGE_SIZE + (PAGE_SIZE - 1)

    const keys = this.derivationPath
      ? await this.#keyIterator.retrieve(startIdx, endIdx)
      : await this.#keyIterator.retrieve(startIdx, endIdx, this.derivationPath)

    keys.forEach(async (key) => {
      const smartAccount: Account = await getSmartAccount(key)
      accounts.push(getLegacyAccount(key))
      accounts.push(smartAccount)
    })

    const accountsWithNetworks = await this.getAccountsUsedNetworks({
      accounts,
      networks,
      providers
    })

    return accountsWithNetworks
  }

  // eslint-disable-next-line class-methods-use-this
  async getAccountsUsedNetworks({
    accounts,
    networks,
    providers
  }: {
    accounts: Account[]
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): Promise<ExtendedAccount[]> {
    const accountsObj: { [key: string]: ExtendedAccount } = Object.fromEntries(
      accounts.map((a) => [a.addr, { ...a, usedOnNetworks: [] }])
    )

    Object.keys(providers).forEach(async (providerKey: NetworkId) => {
      const network = networks.find((n) => n.id === providerKey) as NetworkDescriptor
      if (network) {
        const accountState = await getAccountState(providers[providerKey], network, accounts)
        accountState.forEach((acc) => {
          if (acc.balance > BigInt(0) || acc.nonce > 0) {
            accountsObj[acc.accountAddr].usedOnNetworks.push(network)
          }
        })
      }
    })

    return Object.values(accountsObj)
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
    // get the first page with the new derivationPath
    this.getPage({ page: 1, networks, providers })
  }

  selectAccount(account: Account) {
    this.selectedAccounts.push(account)
  }

  async deselectAccount(account: Account) {
    const accIdx = this.selectedAccounts.findIndex((acc) => acc.addr === account.addr)

    if (accIdx !== -1) {
      this.selectedAccounts = this.selectedAccounts.filter((_, i) => i !== accIdx)
    } else {
      throw new Error('accountAdder: account not found. Cannot deselect.')
    }
  }

  async addAccounts(): Promise<void> {
    const accounts = await this.storage.get('accounts', [])
    this.storage.set('accounts', [...accounts, ...this.selectedAccounts])
  }

  async getPage({
    page,
    networks,
    providers
  }: {
    page: number
    networks: NetworkDescriptor[]
    providers: { [key: string]: JsonRpcProvider }
  }): Promise<Account[]> {
    if (page <= 0) {
      throw new Error('accountAdder: page must be a positive number')
    }

    this.page = page
    return this.iterateAccounts({ networks, providers })
  }

  async searchForLinkedAccounts(eoas: Account[], authKey: string) {
    const allUniqueOwned: { [key: string]: string } = {}

    await Promise.all(
      eoas.map(async (acc: Account) => {
        const resp = await this.callRelayer(
          `/identity/any/by-owner/${acc.addr}/${authKey}?includeFormerlyOwned=true`
        )
        const privEntries = Object.entries(await resp.json())
        privEntries.forEach(([entryId, _]) => {
          allUniqueOwned[entryId] = getAddress(acc.addr)
        })
      })
    )
    return Promise.all(Object.entries(allUniqueOwned))
  }
}

export default AccountAdder
