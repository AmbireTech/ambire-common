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
  updateAccountPreferences: 'INITIAL'
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

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor(
    storage: Storage,
    providers: ProvidersController,
    networks: NetworksController,
    onSelectAccount: (toAccountAddr: string) => void
  ) {
    super()
    this.#storage = storage
    this.#providers = providers
    this.#networks = networks
    this.#onSelectAccount = onSelectAccount

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
    // TODO: error handling here
    this.accountStates = await this.#getAccountsInfo(this.accounts)
    this.emitUpdate()
  }

  async selectAccount(toAccountAddr: string) {
    await this.withStatus('selectAccount', async () => this.#selectAccount(toAccountAddr))
  }

  async #selectAccount(toAccountAddr: string) {
    await this.initialLoadPromise
    // TODO: error handling, trying to switch to account that does not exist
    if (!this.accounts.find((acc) => acc.addr === toAccountAddr)) return
    this.selectedAccount = toAccountAddr
    await this.#storage.set('selectedAccount', toAccountAddr)
    this.#onSelectAccount(toAccountAddr)

    this.emitUpdate()
  }

  async updateAccountStates(blockTag: string | number = 'latest', networks: NetworkId[] = []) {
    this.accountStates = await this.#getAccountsInfo(this.accounts, blockTag, networks)
    this.emitUpdate()
  }

  async #getAccountsInfo(
    accounts: Account[],
    blockTag: string | number = 'latest',
    updateOnlyNetworksWithIds: NetworkId[] = []
  ): Promise<AccountStates> {
    // if any, update the account state only for the passed networks; else - all
    const updateOnlyPassedNetworks = updateOnlyNetworksWithIds.length
    const networksToUpdate = updateOnlyPassedNetworks
      ? this.#networks.networks.filter((network) => updateOnlyNetworksWithIds.includes(network.id))
      : this.#networks.networks

    const fetchedState = await Promise.all(
      networksToUpdate.map(async (network) =>
        getAccountState(this.#providers.providers[network.id], network, accounts, blockTag).catch(
          () => []
        )
      )
    )

    const networkState: { [networkId: NetworkId]: AccountOnchainState[] } = {}
    networksToUpdate.forEach((network: Network, index) => {
      if (!fetchedState[index].length) return

      networkState[network.id] = fetchedState[index]
    })

    const states = accounts.reduce((accStates: AccountStates, acc: Account, accIndex: number) => {
      const networkStates = this.#networks.networks.reduce(
        (netStates: AccountStates[keyof AccountStates], network) => {
          // if a flag for updateOnlyPassedNetworks is passed, we load the ones not requested from the previous state
          if (updateOnlyPassedNetworks && !updateOnlyNetworksWithIds.includes(network.id)) {
            return { ...netStates, [network.id]: this.accountStates?.[acc.addr]?.[network.id] }
          }

          if (!(network.id in networkState) || !(accIndex in networkState[network.id])) {
            this.#providers.updateProviderIsWorking(network.id, false)
            return netStates
          }

          this.#providers.updateProviderIsWorking(network.id, true)

          return { ...netStates, [network.id]: networkState[network.id][accIndex] }
        },
        {}
      )

      return { ...accStates, [acc.addr]: networkStates }
    }, {})

    return states
  }

  async addAccounts(accounts: Account[] = []) {
    if (!accounts.length) return
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

    if (!this.selectedAccount) {
      const defaultSelectedAccount = getDefaultSelectedAccount(accounts)
      if (defaultSelectedAccount) this.#selectAccount(defaultSelectedAccount.addr)
    }
    await this.updateAccountStates()

    this.emitUpdate()
  }

  async updateAccountPreferences(accounts: { addr: string; preferences: AccountPreferences }[]) {
    await this.withStatus(this.updateAccountPreferences.name, async () =>
      this.#updateAccountPreferences(accounts)
    )
  }

  async #updateAccountPreferences(accounts: { addr: string; preferences: AccountPreferences }[]) {
    this.accounts = this.accounts.map((acc) => {
      const account = accounts.find((a) => a.addr === acc.addr)
      if (!account) return acc

      return { ...acc, preferences: account.preferences }
    })
    await this.#storage.set('accounts', this.accounts)
    this.emitUpdate()
  }
}
