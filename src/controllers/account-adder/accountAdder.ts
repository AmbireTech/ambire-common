import { JsonRpcProvider } from 'ethers'
import { NetworkDescriptor, NetworkId } from 'interfaces/networkDescriptor'

import { Account } from '../../interfaces/account'
import { Storage } from '../../interfaces/storage'
import { getAccountState } from '../../libs/accountState/accountState'

const PAGE_SIZE = 5

class AccountAdder {
  storage: Storage

  providers: { [key: string]: JsonRpcProvider }

  networks: NetworkDescriptor[]

  accounts: Account[]

  // keyIterator implements keyIterator and accepts the same props
  keyIterator?: (from: number, to: number, derivation?: string) => string[]

  // optional because there is default derivationPath for each keyIterator
  derivationPath?: string

  page: number = 1

  pageSize: number = PAGE_SIZE

  selectedAccounts: Account[] = []

  preselectedAccounts: Account[] = []

  constructor(
    _storage: Storage,
    _providers: { [key: string]: JsonRpcProvider },
    _networks: NetworkDescriptor[],
    _accounts: Account[]
  ) {
    this.storage = _storage
    this.providers = _providers
    this.networks = _networks
    this.accounts = _accounts
  }

  init({
    _keyIterator,
    _preselectedAccounts,
    _page,
    _pageSize,
    _derivationPath
  }: {
    _keyIterator: (from: number, to: number, derivation?: string) => string[]
    _preselectedAccounts: Account[]
    _page?: number
    _pageSize?: number
    _derivationPath?: string
  }): void {
    this.keyIterator = _keyIterator
    this.preselectedAccounts = _preselectedAccounts
    this.selectedAccounts = []
    this.page = _page || 1
    this.pageSize = _pageSize || PAGE_SIZE
    this.derivationPath = _derivationPath
  }

  reset(): void {
    this.page = 1
    this.pageSize = PAGE_SIZE
    this.selectedAccounts = []
    this.preselectedAccounts = []
    this.derivationPath = undefined
    this.keyIterator = undefined
  }

  async iterateAccounts(): Promise<Account[]> {
    if (!this.keyIterator) {
      throw new Error('accountAdder: keyIterator not initialized')
    }

    const accounts: Account[] = []

    const startIdx = (this.page - 1) * PAGE_SIZE
    const endIdx = (this.page - 1) * PAGE_SIZE + (PAGE_SIZE - 1)

    const keys = this.derivationPath
      ? await this.keyIterator(startIdx, endIdx)
      : await this.keyIterator(startIdx, endIdx, this.derivationPath)

    keys.forEach(async (key) => {
      // TODO: impl getSmartAccount in lib/account
      const smartAccount: Account = await this.getSmartAccount(key)

      accounts.push(this.getLegacyAccount(key))
      accounts.push(smartAccount)
    })

    return accounts
  }

  // Key refers to the public key of a given account
  async getAccountUsedNetworks(key: string): Promise<NetworkDescriptor[]> {
    const usedOnNetworks: NetworkDescriptor[] = []

    Object.keys(this.providers).forEach(async (providerKey: NetworkId) => {
      const network = this.networks.find((n) => n.id === providerKey) as NetworkDescriptor
      const account = this.accounts.find((a) => a.addr === key) as Account
      const [balance, accountState] = await Promise.all([
        this.providers[providerKey].getBalance(key),
        getAccountState(this.providers[providerKey], network, [account])
      ])
      const nonce = accountState[0].nonce

      if (balance !== BigInt(0) && nonce > 0) {
        usedOnNetworks.push(network)
      }
    })

    return usedOnNetworks
  }

  setDerivationPath(path: string): void {
    this.derivationPath = path
    // get the first page with the new derivationPath
    this.getPage(1)
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

  async getPage(pageIndex: number): Promise<Account[]> {
    if (pageIndex <= 0) {
      throw new Error('accountAdder: page must be a positive number')
    }

    this.page = pageIndex
    return this.iterateAccounts()
  }

  // TODO: move to lib/account
  getLegacyAccount(key: string): Account {
    return {
      addr: key,
      label: '',
      pfp: '',
      associatedKeys: [key],
      creation: null
    }
  }
}

export default AccountAdder
