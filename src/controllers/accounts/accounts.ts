import { getAddress, isAddress } from 'ethers'

import {
  Account,
  AccountId,
  AccountOnchainState,
  AccountPreferences,
  AccountStates
} from '../../interfaces/account'
import { Network, NetworkId } from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import {
  getDefaultSelectedAccount,
  migrateAccountPreferencesToAccounts
} from '../../libs/account/account'
import { getAccountState } from '../../libs/accountState/accountState'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'

const STATUS_WRAPPED_METHODS = {
  selectAccount: 'INITIAL',
  updateAccountPreferences: 'INITIAL',
  updateAccountStates: 'INITIAL',
  updateAccountState: 'INITIAL'
} as const

export class AccountsController extends EventEmitter {
  #storage: Storage

  #networks: NetworksController

  #providers: ProvidersController

  accounts: Account[] = []

  selectedAccount: AccountId | null = null

  accountStates: AccountStates = {}

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  #onSelectAccount: (toAccountAddr: string) => void

  #updateProviderIsWorking: (networkId: NetworkId, isWorking: boolean) => void

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor(
    storage: Storage,
    providers: ProvidersController,
    networks: NetworksController,
    onSelectAccount: (toAccountAddr: string) => void,
    updateProviderIsWorking: (networkId: NetworkId, isWorking: boolean) => void
  ) {
    super()
    this.#storage = storage
    this.#providers = providers
    this.#networks = networks
    this.#onSelectAccount = onSelectAccount
    this.#updateProviderIsWorking = updateProviderIsWorking

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load()
  }

  async #load() {
    await this.#networks.initialLoadPromise
    await this.#providers.initialLoadPromise
    const [accounts, selectedAccount, accountPreferences] = await Promise.all([
      this.#storage.get('accounts', []),
      this.#storage.get('selectedAccount', null),
      this.#storage.get('accountPreferences', undefined)
    ])
    if (accountPreferences) {
      this.accounts = migrateAccountPreferencesToAccounts(accountPreferences, accounts)
      await this.#storage.set('accounts', this.accounts)
      await this.#storage.remove('accountPreferences')
    } else {
      this.accounts = accounts
    }
    this.selectedAccount = selectedAccount
    // Emit an update before updating account states as the first state update may take some time
    this.emitUpdate()
    // Don't await this. Networks should update one by one
    this.#updateAccountStates(this.accounts)
  }

  async selectAccount(toAccountAddr: string) {
    await this.withStatus('selectAccount', async () => this.#selectAccount(toAccountAddr))
  }

  async #selectAccount(toAccountAddr: string | null) {
    await this.initialLoadPromise

    if (!toAccountAddr) {
      this.selectedAccount = null
      await this.#storage.remove('selectedAccount')
      this.emitUpdate()
      return
    }
    // TODO: error handling, trying to switch to account that does not exist
    if (!this.accounts.find((acc) => acc.addr === toAccountAddr)) return
    this.selectedAccount = toAccountAddr
    await this.#storage.set('selectedAccount', toAccountAddr)
    this.#onSelectAccount(toAccountAddr)

    this.emitUpdate()
  }

  async updateAccountStates(blockTag: string | number = 'latest', networks: NetworkId[] = []) {
    await this.withStatus('updateAccountStates', async () =>
      this.#updateAccountStates(this.accounts, blockTag, networks)
    )
  }

  async updateAccountState(accountAddr: Account['addr'], blockTag: string | number = 'latest') {
    const accountData = this.accounts.find((account) => account.addr === accountAddr)

    if (!accountData) return

    await this.withStatus('updateAccountState', async () =>
      this.#updateAccountStates([accountData], blockTag)
    )
  }

  async #updateAccountStates(
    accounts: Account[],
    blockTag: string | number = 'latest',
    updateOnlyNetworksWithIds: NetworkId[] = []
  ) {
    // if any, update the account state only for the passed networks; else - all
    const updateOnlyPassedNetworks = updateOnlyNetworksWithIds.length
    const networksToUpdate = updateOnlyPassedNetworks
      ? this.#networks.networks.filter((network) => updateOnlyNetworksWithIds.includes(network.id))
      : this.#networks.networks

    await Promise.all(
      networksToUpdate.map(async (network) => {
        try {
          const networkAccountStates = await getAccountState(
            this.#providers.providers[network.id],
            network,
            accounts,
            blockTag
          )

          this.#updateProviderIsWorking(network.id, true)

          networkAccountStates.forEach((accountState, index) => {
            const { addr } = accounts.find((acc) => acc.addr === accountState.accountAddr) || {}

            if (!addr) return

            if (!this.accountStates[addr]) {
              this.accountStates[addr] = {}
            }

            this.accountStates[addr][network.id] = accountState
          })
        } catch (err) {
          console.error('account state update error: ', err)
          this.#updateProviderIsWorking(network.id, false)
        }

        this.emitUpdate()
      })
    )
  }

  async addAccounts(accounts: Account[] = []) {
    if (!accounts.length) return
    // eslint-disable-next-line no-param-reassign
    accounts = accounts.map((a) => ({ ...a, addr: getAddress(a.addr) }))
    const alreadyAddedAddressSet = new Set(this.accounts.map((account) => account.addr))
    const newAccountsNotAddedYet = accounts.filter((acc) => !alreadyAddedAddressSet.has(acc.addr))
    const newAccountsAlreadyAdded = accounts.filter((acc) => alreadyAddedAddressSet.has(acc.addr))

    const nextAccounts = [
      ...this.accounts.map((acc) => ({
        ...acc,
        // reset the `newlyCreated` state for all already added accounts
        newlyCreated: false,
        // Merge the existing and new associated keys for the account (if the
        // account was already imported). This ensures up-to-date keys,
        // considering changes post-import (associated keys of the smart
        // accounts can change) or incomplete initial data (during the initial
        // import, not all associated keys could have been fetched (for privacy).
        associatedKeys: Array.from(
          new Set([
            ...acc.associatedKeys,
            ...(newAccountsAlreadyAdded.find((x) => x.addr === acc.addr)?.associatedKeys || [])
          ])
        )
      })),
      ...newAccountsNotAddedYet
    ]

    this.accounts = nextAccounts
    await this.#storage.set('accounts', nextAccounts)

    const defaultSelectedAccount = getDefaultSelectedAccount(accounts)
    if (defaultSelectedAccount) {
      await this.#selectAccount(defaultSelectedAccount.addr)
    }

    await this.updateAccountStates()

    this.emitUpdate()
  }

  async removeAccountData(address: Account['addr']) {
    this.accounts = this.accounts.filter((acc) => acc.addr !== address)

    if (this.selectedAccount === address) {
      await this.#selectAccount(this.accounts[0]?.addr)
    }

    delete this.accountStates[address]

    this.#storage.set('accounts', this.accounts)
    this.emitUpdate()
  }

  async updateAccountPreferences(accounts: { addr: string; preferences: AccountPreferences }[]) {
    await this.withStatus('updateAccountPreferences', async () =>
      this.#updateAccountPreferences(accounts)
    )
  }

  async #updateAccountPreferences(accounts: { addr: string; preferences: AccountPreferences }[]) {
    this.accounts = this.accounts.map((acc) => {
      const account = accounts.find((a) => a.addr === acc.addr)
      if (!account) return acc
      if (isAddress(account.preferences.pfp)) {
        account.preferences.pfp = getAddress(account.preferences.pfp)
      }
      return { ...acc, preferences: account.preferences }
    })
    await this.#storage.set('accounts', this.accounts)
    this.emitUpdate()
  }
}
