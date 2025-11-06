import { getAddress, isAddress } from 'ethers'

import AmbireSmartAccountIdentityCreateError from '../../classes/AmbireSmartAccountIdentityCreateError'
import {
  IRecurringTimeout,
  RecurringTimeout
} from '../../classes/recurringTimeout/recurringTimeout'
import { PROXY_AMBIRE_ACCOUNT } from '../../consts/deploy'
import {
  SMART_ACCOUNT_IDENTITY_RETRY_INTERVAL,
  VIEW_ONLY_ACCOUNT_IDENTITY_GET_INTERVAL
} from '../../consts/intervals'
import {
  Account,
  AccountIdentityResponse,
  AccountOnchainState,
  AccountPreferences,
  AccountStates,
  AmbireSmartAccountIdentityCreateRequest,
  AmbireSmartAccountIdentityCreateResponse,
  IAccountsController
} from '../../interfaces/account'
import { Statuses } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { dedicatedToOneSAPriv, IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import {
  getUniqueAccountsArray,
  isAmbireV1LinkedAccount,
  isAmbireV2Account,
  isSmartAccount
} from '../../libs/account/account'
import { normalizeIdentityResponse } from '../../libs/accountPicker/accountPicker'
import { getAccountState } from '../../libs/accountState/accountState'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import EventEmitter from '../eventEmitter/eventEmitter'

export const STATUS_WRAPPED_METHODS = {
  selectAccount: 'INITIAL',
  addAccounts: 'INITIAL'
} as const

export class AccountsController extends EventEmitter implements IAccountsController {
  #storage: IStorageController

  #networks: INetworksController

  #providers: IProvidersController

  #keystore: IKeystoreController

  #callRelayer: Function

  /**
   * Creating Ambire smart account identity is needed but not critical, user
   * is still able to interact and transfer funds with a smart account one.
   * So schedule an interval to retry after import, allowing the user
   * to import the account even if the first Relayer identity create call fails.
   */
  #smartAccountIdentityCreateInterval: IRecurringTimeout

  /**
   * Getting view-only accounts’ identity is needed but not critical,
   * so schedule an interval to retry after import, allowing the user
   * to import the account even if the first Relayer identity fetch fails.
   */
  #viewOnlyAccountGetIdentityInterval: IRecurringTimeout

  #accounts: Account[] = []

  accountStates: AccountStates = {}

  accountStatesLoadingState: {
    [chainId: string]: Promise<AccountOnchainState[]> | undefined
  } = {}

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  #onAddAccounts: (accounts: Account[]) => void

  #updateProviderIsWorking: (chainId: bigint, isWorking: boolean) => void

  #onAccountStateUpdate: () => void

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  // Tracks the initial load of account states. Unlike `initialLoadPromise`,
  // this one isn’t awaited during the AccountsController initial load, so it’s the only
  // reliable way to know when account states are fully loaded.
  accountStatesInitialLoadPromise?: Promise<void>

  constructor(
    storage: IStorageController,
    providers: IProvidersController,
    networks: INetworksController,
    keystore: IKeystoreController,
    onAddAccounts: (accounts: Account[]) => void,
    updateProviderIsWorking: (chainId: bigint, isWorking: boolean) => void,
    onAccountStateUpdate: () => void,
    relayerUrl: string,
    fetch: Fetch
  ) {
    super()
    this.#storage = storage
    this.#providers = providers
    this.#networks = networks
    this.#keystore = keystore
    this.#onAddAccounts = onAddAccounts
    this.#updateProviderIsWorking = updateProviderIsWorking
    this.#onAccountStateUpdate = onAccountStateUpdate
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })

    this.#viewOnlyAccountGetIdentityInterval = new RecurringTimeout(
      this.setViewOnlyAccountIdentitiesIfNeeded.bind(this),
      VIEW_ONLY_ACCOUNT_IDENTITY_GET_INTERVAL,
      this.emitError.bind(this)
    )

    this.#smartAccountIdentityCreateInterval = new RecurringTimeout(
      this.createSmartAccountIdentitiesIfNeeded.bind(this),
      SMART_ACCOUNT_IDENTITY_RETRY_INTERVAL,
      this.emitError.bind(this)
    )

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  #getAccountsToUpdateAccountStatesInBackground(selectedAccountAddr?: string | null): Account[] {
    return this.accounts.filter((account) => {
      // Always update the selected account state in the background
      if (account.addr === selectedAccountAddr) return true

      const accountKeys = this.#keystore.getAccountKeys(account)
      const isViewOnly = accountKeys.length === 0
      // If the account is not selected, update the account state in the background
      // only if it's not view-only. We update the account state
      // in the background so EOAs can be used as a broadcast option.
      return !isViewOnly
    })
  }

  async #load() {
    await this.#networks.initialLoadPromise
    await this.#providers.initialLoadPromise
    const accounts = await this.#storage.get('accounts', [])
    const initialSelectedAccountAddr = await this.#storage.get('selectedAccount', null)
    this.accounts = getUniqueAccountsArray(accounts)

    // Emit an update before updating account states as the first state update may take some time
    this.emitUpdate()
    // Don't await this. Networks should update one by one
    // NOTE: YOU MUST USE waitForAccountsCtrlFirstLoad IN TESTS
    // TO ENSURE ACCOUNT STATE IS LOADED
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.accountStatesInitialLoadPromise = this.#updateAccountStates(
      this.#getAccountsToUpdateAccountStatesInBackground(initialSelectedAccountAddr)
    ).finally(() => {
      this.accountStatesInitialLoadPromise = undefined
    })
  }

  get accounts() {
    return this.#accounts
  }

  set accounts(nextAccounts) {
    const prevAccountsCount = this.#accounts.length
    const nextAccountsCount = nextAccounts.length
    this.#accounts = nextAccounts

    const noNewAccountsAndNotInitialLoad = nextAccountsCount <= prevAccountsCount
    if (noNewAccountsAndNotInitialLoad) return
    this.#viewOnlyAccountGetIdentityInterval.restart({ runImmediately: true })
    this.#smartAccountIdentityCreateInterval.restart({ runImmediately: true })
  }

  async updateAccountStates(
    selectedAccountAddr: string | undefined,
    blockTag: string | number = 'latest',
    networks: bigint[] = []
  ) {
    await this.initialLoadPromise

    await this.#updateAccountStates(
      this.#getAccountsToUpdateAccountStatesInBackground(selectedAccountAddr),
      blockTag,
      networks
    )
  }

  async updateAccountState(
    accountAddr: Account['addr'],
    blockTag: 'pending' | 'latest' = 'latest',
    networks: bigint[] = []
  ) {
    await this.initialLoadPromise

    const accountData = this.accounts.find((account) => account.addr === accountAddr)
    if (!accountData) return
    await this.#updateAccountStates([accountData], blockTag, networks)
  }

  async #updateAccountStates(
    accounts: Account[],
    blockTag: string | number = 'latest',
    updateOnlyNetworksWithIds: bigint[] = []
  ) {
    if (!accounts.length) return

    // if any, update the account state only for the passed networks; else - all
    const updateOnlyPassedNetworks = updateOnlyNetworksWithIds.length
    const networksToUpdate = this.#networks.networks.filter((network) => {
      if (!updateOnlyPassedNetworks) return true

      return updateOnlyNetworksWithIds.includes(network.chainId)
    })

    this.emitUpdate()

    await Promise.all(
      networksToUpdate.map(async (network) => {
        try {
          if (this.accountStatesLoadingState[network.chainId.toString()]) {
            await this.accountStatesLoadingState[network.chainId.toString()]

            return
          }

          this.accountStatesLoadingState[network.chainId.toString()] = getAccountState(
            this.#providers.providers[network.chainId.toString()],
            network,
            accounts,
            blockTag
          )
          const networkAccountStates = await this.accountStatesLoadingState[
            network.chainId.toString()
          ]!

          this.#updateProviderIsWorking(network.chainId, true)

          networkAccountStates.forEach((accountState) => {
            const addr = accountState.accountAddr
            if (!this.accountStates[addr]) this.accountStates[addr] = {}

            // if the block tag is pending & we have a fetched latest state,
            // we check each nonce against the latest state.
            // if the pending nonce is lower than the latest state, we override the res
            // also, we check isDeployed, isSmarterEoa & isEOA
            // we do this because rogue RPCs sometimes mess up the pending state
            if (blockTag === 'pending') {
              const current = this.accountStates[addr][network.chainId.toString()]
              const toState =
                current && current.currentBlock >= accountState.currentBlock
                  ? current
                  : accountState
              this.accountStates[addr][network.chainId.toString()] = toState
            } else {
              this.accountStates[addr][network.chainId.toString()] = accountState
            }
          })
        } catch (err: any) {
          this.emitError({
            level: 'silent',
            message: `Failed to update account state for ${network.name}`,
            error: err
          })
          this.#updateProviderIsWorking(network.chainId, false)
        } finally {
          this.accountStatesLoadingState[network.chainId.toString()] = undefined
        }
        this.emitUpdate()
      })
    )

    this.#onAccountStateUpdate()
  }

  async #addAccounts(accounts: Account[] = []) {
    if (!accounts.length) return
    // eslint-disable-next-line no-param-reassign
    accounts = accounts.map((a) => ({ ...a, addr: getAddress(a.addr) }))
    const alreadyAddedAddressSet = new Set(this.accounts.map((account) => account.addr))
    const newAccountsNotAddedYet = accounts.filter((acc) => !alreadyAddedAddressSet.has(acc.addr))
    const newAccountsAlreadyAdded = accounts.filter((acc) => alreadyAddedAddressSet.has(acc.addr))

    const nextAccounts = [
      ...this.accounts.map((acc) => ({
        ...acc,
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

  async addAccounts(accounts: Account[] = []) {
    await this.withStatus('addAccounts', async () => this.#addAccounts(accounts), true)
  }

  removeAccountData(address: Account['addr']) {
    this.accounts = this.accounts.filter((acc) => acc.addr !== address)

    delete this.accountStates[address]

    this.#storage.set('accounts', this.accounts)
    this.emitUpdate()
  }

  async updateAccountPreferences(accounts: { addr: string; preferences: AccountPreferences }[]) {
    this.accounts = this.accounts.map((acc) => {
      const account = accounts.find((a) => a.addr === acc.addr)
      if (!account) return acc
      if (isAddress(account.preferences.pfp)) {
        account.preferences.pfp = getAddress(account.preferences.pfp)
      }
      return { ...acc, preferences: account.preferences }
    })

    this.emitUpdate()
    await this.#storage.set('accounts', this.accounts)
  }

  async reorderAccounts({ fromIndex, toIndex }: { fromIndex: number; toIndex: number }) {
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= this.accounts.length ||
      toIndex >= this.accounts.length
    ) {
      return this.emitError({
        level: 'major',
        message: 'Failed to reorder accounts. Please reload the page and try again.',
        error: new Error('Failed to reorder accounts. Please reload the page and try again.')
      })
    }

    if (fromIndex === toIndex) return

    const updatedAccounts = [...this.accounts]
    const [movedAccount] = updatedAccounts.splice(fromIndex, 1)
    updatedAccounts.splice(toIndex, 0, movedAccount)

    this.accounts = getUniqueAccountsArray(updatedAccounts)

    this.emitUpdate()
    await this.#storage.set('accounts', this.accounts)
  }

  get areAccountStatesLoading() {
    return Object.values(this.accountStatesLoadingState).some((isLoading) => isLoading)
  }

  // Get the account states or in the rare case of it being undefined,
  // fetch it.
  // This is a precaution method as we had bugs in the past where we assumed
  // the account state to be fetched only for it to haven't been.
  // This ensures production doesn't blow up and it 99.9% of cases it
  // should not call the promise
  async getOrFetchAccountStates(addr: string): Promise<{ [chainId: string]: AccountOnchainState }> {
    if (!this.accountStates[addr]) await this.updateAccountState(addr, 'latest')
    return this.accountStates[addr]
  }

  // Get the account state or in the rare case of it being undefined,
  // fetch it.
  // This is a precaution method as we had bugs in the past where we assumed
  // the account state to be fetched only for it to haven't been.
  // This ensures production doesn't blow up and it 99.9% of cases it
  // should not call the promise
  async getOrFetchAccountOnChainState(addr: string, chainId: bigint): Promise<AccountOnchainState> {
    if (!this.accountStates[addr]?.[chainId.toString()]) {
      await this.updateAccountState(addr, 'latest', [chainId])
    }

    return this.accountStates[addr][chainId.toString()]
  }

  resetAccountsNewlyAddedState() {
    this.accounts = this.accounts.map((a) => ({ ...a, newlyAdded: false }))
    this.emitUpdate()
  }

  async forceFetchPendingState(addr: string, chainId: bigint): Promise<AccountOnchainState> {
    await this.updateAccountState(addr, 'pending', [chainId])
    return this.accountStates[addr][chainId.toString()]
  }

  async setViewOnlyAccountIdentitiesIfNeeded(): Promise<void> {
    const viewOnlyAccountsNeedingIdentityFetch = this.accounts.filter(
      (a) => !this.#keystore.getAccountKeys(a).length && !a.identityFetchedAt
    )

    if (!viewOnlyAccountsNeedingIdentityFetch.length)
      return this.#viewOnlyAccountGetIdentityInterval.stop()

    const accountsToFetchIdentity: Promise<Account>[] = viewOnlyAccountsNeedingIdentityFetch.map(
      async (a) => {
        const identityRes: AccountIdentityResponse = await this.#callRelayer(
          `/v2/identity/${a.addr}`
        ).catch((err: any) => {
          // 404 response (if the account is not found) is a valid response, do not throw
          if (err?.output?.res?.status === 404) return null

          throw err
        })
        const { creation, initialPrivileges, associatedKeys } = await normalizeIdentityResponse(
          a.addr,
          identityRes
        )

        const now = Date.now()
        return {
          ...a,
          identityFetchedAt: now,
          associatedKeys,
          initialPrivileges,
          creation
        }
      }
    )

    const results = await Promise.allSettled(accountsToFetchIdentity)

    // Collect fulfilled results (accounts with updated identities)
    const fulfilledAccountsWithIdentities: Account[] = results
      .filter((r) => r.status === 'fulfilled' && r.value)
      .map((r) => (r as PromiseFulfilledResult<Account>).value)

    // Update only accounts whose identity fetch succeeded
    this.accounts = this.accounts.map((a) => {
      const updated = fulfilledAccountsWithIdentities.find((f) => f.addr === a.addr)
      return updated || a
    })

    // Stop the interval immediately if all promises were fulfilled (otherwise,
    // it would make one more circle and then stop because of the guard upfront)
    const allPromisesFulfilled = results.every((r) => r.status === 'fulfilled')
    if (allPromisesFulfilled) this.#viewOnlyAccountGetIdentityInterval.stop()

    this.emitUpdate()
    await this.#storage.set('accounts', this.accounts)
  }

  /**
   * Creates identity for smart accounts on the Relayer and updates the accounts
   * with the identityCreatedAt timestamp. Handles retry mechanism for failed requests.
   */
  async createSmartAccountIdentitiesIfNeeded(): Promise<void> {
    const smartAccountsNeedingIdentityCreate = this.accounts.filter(
      (a) =>
        isSmartAccount(a) &&
        isAmbireV2Account(a.creation?.factoryAddr) &&
        this.#keystore.getAccountKeys(a).length &&
        !a.creation?.identityCreatedAt
    )

    if (!smartAccountsNeedingIdentityCreate.length)
      return this.#smartAccountIdentityCreateInterval.stop()

    const identityRequests: AmbireSmartAccountIdentityCreateRequest[] =
      smartAccountsNeedingIdentityCreate.map((account) => ({
        addr: account.addr,
        ...(account.email ? { email: account.email } : {}),
        associatedKeys: account.initialPrivileges.length
          ? account.initialPrivileges
          : // default initialPrivileges, Ambire v2 accounts always have these
            // privileges, because key management for them got never implemented.
            [[account.associatedKeys[0], dedicatedToOneSAPriv]],
        creation: {
          factoryAddr: account.creation!.factoryAddr,
          salt: account.creation!.salt,
          // No need to retrieve the base identity address from the bytecode
          // because all Ambire smart accounts v2 has the same
          baseIdentityAddr: PROXY_AMBIRE_ACCOUNT
        }
      }))

    try {
      const identityRes = (await this.#callRelayer('/v2/identity/create-multiple', 'POST', {
        accounts: identityRequests
      })) as AmbireSmartAccountIdentityCreateResponse

      if (!identityRes.success || !identityRes.body) throw new Error(JSON.stringify(identityRes))

      // This treats every response entry as a successful identity creation.
      // There is a boolean for `r.status.created`, but it indicates if the
      // identity was just created (new account), where here we just want to
      // make sure account identity exists, no matter if it was created now or previously
      // Update the accounts that just had their identities created
      const identityExists = identityRes.body.map((r) => r.identity)
      const now = Date.now()
      this.accounts = this.accounts.map((account) => {
        if (!identityExists.includes(account.addr)) return account

        // should never happen
        if (!account.creation) {
          const message = `accounts: Identity created for ${account.addr} which lacks creation data.`
          const error = new Error(message)
          this.emitError({ message, level: 'silent', sendCrashReport: true, error })

          return account
        }

        // Force refresh `initialPrivileges` from `identityRequests`.
        // 1) Fixes pre-v5.30.0 imports where view-only -> reimport with key left `initialPrivileges` empty.
        // 2) Post-v5.30.0 this is safe, as Ambire v2 accounts always share the same
        // privileges, because key management for them got never implemented.
        const initialPrivileges =
          identityRequests.find((a) => a.addr === account.addr)?.associatedKeys ||
          account.initialPrivileges

        const creation = { ...account.creation, identityCreatedAt: now }

        return { ...account, initialPrivileges, creation }
      })

      this.emitUpdate()
      await this.#storage.set('accounts', this.accounts)

      const identityRequestsFailedToCreate = identityRequests.filter(
        (req) => !identityExists.includes(req.addr)
      )
      if (identityRequestsFailedToCreate.length)
        throw new AmbireSmartAccountIdentityCreateError(identityRequestsFailedToCreate)

      // Stop the interval immediately upon success (otherwise, it would make
      // one more circle and then stop because of the guard upfront)
      this.#smartAccountIdentityCreateInterval.stop()
    } catch (error: any) {
      const identitiesFailedToCreate =
        error instanceof AmbireSmartAccountIdentityCreateError
          ? error.identityRequests.map((req) => req.addr) // only some failed
          : identityRequests.map((req) => req.addr) // all failed

      const message = `accounts: Failed to create smart account identities for: ${identitiesFailedToCreate.join(
        ', '
      )}`
      this.emitError({ message, level: 'silent', sendCrashReport: true, error })
    }
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      areAccountStatesLoading: this.areAccountStatesLoading,
      accounts: this.accounts
    }
  }
}
