import { getAddress, isAddress } from 'ethers'

import {
  Account,
  AccountOnchainState,
  AccountPreferences,
  AccountStates
} from '../../interfaces/account'
import { NetworkId } from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import {
  getUniqueAccountsArray,
  migrateAccountPreferencesToAccounts
} from '../../libs/account/account'
import { getAccountState } from '../../libs/accountState/accountState'
import { InternalSignedMessages, SignedMessage } from '../activity/types'
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

  accountStates: AccountStates = {}

  accountStatesLoadingState: {
    [networkId: string]: boolean
  } = {}

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  #onAddAccounts: (accounts: Account[]) => void

  #updateProviderIsWorking: (networkId: NetworkId, isWorking: boolean) => void

  #onAccountStateUpdate: () => void

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  // all SignedMessage type 7702-authorization the user has signed
  #authorizations: InternalSignedMessages

  constructor(
    storage: Storage,
    providers: ProvidersController,
    networks: NetworksController,
    onAddAccounts: (accounts: Account[]) => void,
    updateProviderIsWorking: (networkId: NetworkId, isWorking: boolean) => void,
    onAccountStateUpdate: () => void
  ) {
    super()
    this.#storage = storage
    this.#providers = providers
    this.#networks = networks
    this.#onAddAccounts = onAddAccounts
    this.#updateProviderIsWorking = updateProviderIsWorking
    this.#onAccountStateUpdate = onAccountStateUpdate

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load()
    this.#authorizations = {}
  }

  async #load() {
    await this.#networks.initialLoadPromise
    await this.#providers.initialLoadPromise
    const [accounts, accountPreferences, storageSignedMessages] = await Promise.all([
      this.#storage.get('accounts', []),
      this.#storage.get('accountPreferences', undefined),
      this.#storage.get('signedMessages', {})
    ])
    if (accountPreferences) {
      this.accounts = getUniqueAccountsArray(
        migrateAccountPreferencesToAccounts(accountPreferences, accounts)
      )
      await this.#storage.set('accounts', this.accounts)
      await this.#storage.remove('accountPreferences')
    } else {
      this.accounts = getUniqueAccountsArray(accounts)
    }

    // add all the authorizations the user has signed
    const signedMessages = storageSignedMessages as InternalSignedMessages
    this.accounts.forEach((acc) => {
      if (!signedMessages[acc.addr] || signedMessages[acc.addr].length === 0) return

      this.#authorizations[acc.addr] = signedMessages[acc.addr].filter(
        (msg) => msg.content.kind === 'authorization-7702'
      )
    })

    // Emit an update before updating account states as the first state update may take some time
    this.emitUpdate()
    // Don't await this. Networks should update one by one
    this.#updateAccountStates(this.accounts)
  }

  update({ authorization }: { authorization: SignedMessage }) {
    if (authorization.content.kind !== 'authorization-7702') return

    if (!this.#authorizations[authorization.accountAddr])
      this.#authorizations[authorization.accountAddr] = []
    this.#authorizations[authorization.accountAddr].push(authorization)

    // update the account state only for the account that signed the message
    // and only for the networks the messages has been signed on
    // unless chainId is 0 (no network selected)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#updateAccountStates(
      this.accounts.filter((acc) => acc.addr === authorization.accountAddr),
      'latest',
      authorization.content.chainId !== 0n ? [authorization.networkId] : []
    )
  }

  async updateAccountStates(blockTag: string | number = 'latest', networks: NetworkId[] = []) {
    await this.#updateAccountStates(this.accounts, blockTag, networks)
  }

  async updateAccountState(
    accountAddr: Account['addr'],
    blockTag: 'pending' | 'latest' = 'latest',
    networks: NetworkId[] = []
  ) {
    const accountData = this.accounts.find((account) => account.addr === accountAddr)

    if (!accountData) return

    await this.#updateAccountStates([accountData], blockTag, networks)
  }

  async #updateAccountStates(
    accounts: Account[],
    blockTag: string | number = 'latest',
    updateOnlyNetworksWithIds: NetworkId[] = []
  ) {
    // if any, update the account state only for the passed networks; else - all
    const updateOnlyPassedNetworks = updateOnlyNetworksWithIds.length
    const networksToUpdate = this.#networks.networks.filter((network) => {
      if (this.accountStatesLoadingState[network.id]) return false
      if (!updateOnlyPassedNetworks) return true

      return updateOnlyNetworksWithIds.includes(network.id)
    })

    networksToUpdate.forEach((network) => {
      this.accountStatesLoadingState[network.id] = true
    })
    this.emitUpdate()

    await Promise.all(
      networksToUpdate.map(async (network) => {
        try {
          const networkAccountStates = await getAccountState(
            this.#providers.providers[network.id],
            network,
            accounts,
            this.#authorizations,
            blockTag
          )

          this.#updateProviderIsWorking(network.id, true)

          networkAccountStates.forEach((accountState) => {
            const addr = accountState.accountAddr

            if (!this.accountStates[addr]) {
              this.accountStates[addr] = {}
            }

            this.accountStates[addr][network.id] = accountState
          })
        } catch (err) {
          console.error(`account state update error for ${network.name}: `, err)
          this.#updateProviderIsWorking(network.id, false)
        } finally {
          this.accountStatesLoadingState[network.id] = false
        }
        this.emitUpdate()
      })
    )

    this.#onAccountStateUpdate()
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
        // reset the `newlyAdded` state for all accounts added on prev sessions
        newlyAdded: false,
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
      ...newAccountsNotAddedYet.map((a) => ({ ...a, newlyAdded: true }))
    ]

    this.accounts = getUniqueAccountsArray(nextAccounts)
    await this.#storage.set('accounts', this.accounts)

    this.#onAddAccounts(accounts)

    // update the state of new accounts. Otherwise, the user needs to restart his extension
    this.#updateAccountStates(newAccountsNotAddedYet)

    this.emitUpdate()
  }

  async removeAccountData(address: Account['addr']) {
    this.accounts = this.accounts.filter((acc) => acc.addr !== address)

    delete this.accountStates[address]
    if (this.#authorizations[address]) delete this.#authorizations[address]
    this.#storage.set('accounts', this.accounts)
    this.emitUpdate()
  }

  async updateAccountPreferences(accounts: { addr: string; preferences: AccountPreferences }[]) {
    await this.withStatus(
      'updateAccountPreferences',
      async () => this.#updateAccountPreferences(accounts),
      true
    )
  }

  async #updateAccountPreferences(accounts: { addr: string; preferences: AccountPreferences }[]) {
    this.accounts = this.accounts.map((acc) => {
      const account = accounts.find((a) => a.addr === acc.addr)
      if (!account) return acc
      if (isAddress(account.preferences.pfp)) {
        account.preferences.pfp = getAddress(account.preferences.pfp)
      }
      return { ...acc, preferences: account.preferences, newlyAdded: false }
    })

    await this.#storage.set('accounts', this.accounts)
    this.emitUpdate()
  }

  get areAccountStatesLoading() {
    return Object.values(this.accountStatesLoadingState).some((isLoading) => isLoading)
  }

  // Get the account state or in the rare case of it being undefined,
  // fetch it.
  // This is a precaution method as we had bugs in the past where we assumed
  // the account state to be fetched only for it to haven't been.
  // This ensures production doesn't blow up and it 99.9% of cases it
  // should not call the promise
  async getOrFetchAccountOnChainState(
    addr: string,
    networkId: string
  ): Promise<AccountOnchainState> {
    if (!this.accountStates[addr]) await this.updateAccountState(addr, 'latest', [networkId])
    if (!this.accountStates[addr][networkId])
      await this.updateAccountState(addr, 'latest', [networkId])

    return this.accountStates[addr][networkId]
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      areAccountStatesLoading: this.areAccountStatesLoading
    }
  }
}
