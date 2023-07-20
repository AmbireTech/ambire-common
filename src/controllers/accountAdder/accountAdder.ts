import { getAddress, JsonRpcProvider } from 'ethers'
import { KeyIterator } from 'interfaces/keyIterator'
import { NetworkDescriptor, NetworkId } from 'interfaces/networkDescriptor'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { Storage } from '../../interfaces/storage'
import { getLegacyAccount, getSmartAccount } from '../../libs/account/account'
import { getAccountState } from '../../libs/accountState/accountState'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import EventEmitter from '../eventEmitter'

const PAGE_SIZE = 5

type ExtendedAccount = Account & { usedOnNetworks: NetworkDescriptor[] }
export class AccountAdderController extends EventEmitter {
  #callRelayer: Function

  storage: Storage

  #keyIterator?: KeyIterator

  // optional because there is default derivationPath for each keyIterator
  derivationPath?: string

  isReady: boolean = false

  // This is only the index of the current page
  page: number = 1

  pageSize: number = PAGE_SIZE

  selectedAccounts: Account[] = []

  preselectedAccounts: Account[] = []

  // The result of getPage
  pageAddresses: ExtendedAccount[] = []

  constructor(_storage: Storage, _relayerUrl: string) {
    super()
    this.storage = _storage
    this.#callRelayer = relayerCall.bind({ url: _relayerUrl })
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
    if (!this.#keyIterator || !this.isReady) {
      throw new Error('accountAdder: keyIterator not initialized')
    }

    const accounts: Account[] = []

    const startIdx = (this.page - 1) * this.pageSize
    const endIdx = (this.page - 1) * this.pageSize + (this.pageSize - 1)

    const keys = this.derivationPath
      ? await this.#keyIterator.retrieve(startIdx, endIdx)
      : await this.#keyIterator.retrieve(startIdx, endIdx, this.derivationPath)

    // eslint-disable-next-line no-restricted-syntax
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      const smartAccount = await getSmartAccount(key)
      accounts.push(getLegacyAccount(key))
      accounts.push(smartAccount)
    }

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
        const accountState = await getAccountState(
          providers[providerKey],
          network,
          accounts.map((acc: Account) => ({
            ...acc,
            creation: {
              factoryAddr: '0x0000000000000000000000000000000000000000',
              bytecode: '0x00',
              salt: '0x0'
            }
          }))
        )
        accountState.forEach((acc: AccountOnchainState) => {
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

  async addAccounts(): Promise<void> {
    const accounts = await this.storage.get('accounts', [])
    this.storage.set('accounts', [...accounts, ...this.selectedAccounts])
    this.selectedAccounts = []

    // TODO: add the newly created smart accounts to the relayer
    // TODO: store the personalized data for each account on the relayer
    // should we add some data about the legacy accounts as well?
  }

  async getPage({
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
    const pageAddresses = await this.iterateAccounts({ networks, providers })
    this.pageAddresses = pageAddresses
    this.emitUpdate()
  }

  async getAccountByAddr({
    idAddr,
    signerAddr,
    authKey
  }: {
    idAddr: string
    signerAddr: string
    authKey: string
  }) {
    // In principle, we need these values to be able to operate in relayerless mode,
    // so we just store them in all cases
    // Plus, in the future this call may be used to retrieve other things
    const { salt, identityFactoryAddr, baseIdentityAddr, bytecode } = await this.#callRelayer(
      `/identity/${idAddr}`,
      'GET',
      {
        authKey
      }
    ).then((r: any) => r.json())
    if (!(salt && identityFactoryAddr && baseIdentityAddr && bytecode))
      throw new Error(`Incomplete data from relayer for ${idAddr}`)
    return {
      addr: idAddr,
      salt,
      identityFactoryAddr,
      baseIdentityAddr,
      bytecode,
      signer: { address: signerAddr }
    }
  }

  async searchForLinkedAccounts(eoas: Account[]) {
    const allUniqueOwned: { [key: string]: string } = {}

    await Promise.all(
      eoas.map(async (acc: Account) => {
        const resp = await this.#callRelayer(
          `/identity/any/by-owner/${acc.addr}?includeFormerlyOwned=true`
        )
        const privEntries = Object.entries(await resp.json())
        privEntries.forEach(([entryId, _]) => {
          allUniqueOwned[entryId] = getAddress(acc.addr)
        })
      })
    )
    return Promise.all(Object.entries(allUniqueOwned))
  }

  personalizeAccount(updatedAccount: Account) {
    const accIdx = this.selectedAccounts.findIndex((acc) => acc.addr === updatedAccount.addr)

    this.selectedAccounts[accIdx] = updatedAccount
    this.emitUpdate()
  }
}

export default AccountAdderController
