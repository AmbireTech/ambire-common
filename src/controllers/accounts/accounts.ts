import { getAddress, isAddress } from 'ethers'

import AmbireSmartAccountIdentityCreateError from '../../classes/AmbireSmartAccountIdentityCreateError'
import {
  IRecurringTimeout,
  RecurringTimeout
} from '../../classes/recurringTimeout/recurringTimeout'
import { PROXY_AMBIRE_ACCOUNT } from '../../consts/deploy'
import { FLASHBLOCKS_CHAIN_IDS } from '../../consts/networks'
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
  IAccountsController,
  SafeAccountCreation
} from '../../interfaces/account'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { Fetch } from '../../interfaces/fetch'
import { dedicatedToOneSAPriv, IKeystoreController } from '../../interfaces/keystore'
import { INetworksController, Network } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import { getUniqueAccountsArray, isAmbireV2Account } from '../../libs/account/account'
import { normalizeIdentityResponse } from '../../libs/accountPicker/accountPicker'
import { getAccountState } from '../../libs/accountState/accountState'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { getPendingBlockTagIfSupported } from '../../utils/getBlockTag'
import EventEmitter from '../eventEmitter/eventEmitter'

export const STATUS_WRAPPED_METHODS = {
  addAccounts: 'INITIAL'
} as const

type AccountStateBlockTag = 'latest' | 'pending'

/** The queued jobs and fetches of one account on one chain. Deleted when its last job ends. */
type AccountStateFetchTracker = {
  /** The last queued job. A new call for the account waits for it. */
  lastJob: Promise<void>
  /** The sequence number of the last fetch that started, by block tag. */
  lastFetchStarted: { [blockTag in AccountStateBlockTag]?: number }
  /** The fetch that runs now, if any. */
  runningFetch?: { startedAt: number; blockTag: AccountStateBlockTag }
}

/**
 * An account in a queued job. Any fetch that starts at or after `coveredFrom` makes its fetch
 * unnecessary.
 */
type QueuedAccountStateFetch = {
  addr: Account['addr']
  tracker: AccountStateFetchTracker
  coveredFrom: number
}

/** Whether a fetch with `fetchBlockTag` also gives the state a `blockTag` call asks for. */
const isBlockTagCovered = (
  fetchBlockTag: AccountStateBlockTag,
  blockTag: AccountStateBlockTag
): boolean => fetchBlockTag === 'pending' || blockTag === 'latest'

/**
 * Stores the wallet accounts and fetches their on-chain state.
 *
 * State fetches run in one queue per account and chain. Calls for different accounts never wait
 * for each other.
 * Calls for the same account run in call order, so an older fetch can't overwrite a newer result.
 * A call without `force` reuses the fetch that runs for its account when the block tag fits, so
 * repeated calls cause no extra RPC load. A call with `force` waits for a fetch that starts after
 * it.
 */
export class AccountsController extends EventEmitter implements IAccountsController {
  #storage: IStorageController

  #networks: INetworksController

  #providers: IProvidersController

  #keystore: IKeystoreController

  #callRelayer: Function

  #featureFlags?: IFeatureFlagsController

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

  #fetchTrackers: { [chainId: string]: { [addr: string]: AccountStateFetchTracker } } = {}

  /** Orders calls and fetches, so a job can tell which fetches started after a call. */
  #sequence = 0

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  #onAddAccounts: (accounts: Account[]) => void

  #updateProviderIsWorking: (chainId: bigint, isWorking: boolean) => void

  #onAccountStateUpdate: () => void

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  // Tracks the initial load of account states. Unlike `initialLoadPromise`,
  // this one isn’t awaited during the AccountsController initial load, so it’s the only
  // reliable way to know when account states are fully loaded.
  accountStateInitialLoadPromise?: Promise<void>

  constructor(
    storage: IStorageController,
    providers: IProvidersController,
    networks: INetworksController,
    keystore: IKeystoreController,
    onAddAccounts: (accounts: Account[]) => void,
    updateProviderIsWorking: (chainId: bigint, isWorking: boolean) => void,
    onAccountStateUpdate: () => void,
    relayerUrl: string,
    fetch: Fetch,
    eventEmitterRegistry?: IEventEmitterRegistryController,
    featureFlags?: IFeatureFlagsController
  ) {
    super(eventEmitterRegistry)
    this.#storage = storage
    this.#providers = providers
    this.#networks = networks
    this.#keystore = keystore
    this.#onAddAccounts = onAddAccounts
    this.#updateProviderIsWorking = updateProviderIsWorking
    this.#onAccountStateUpdate = onAccountStateUpdate
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.#featureFlags = featureFlags

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

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  #getAccountsToUpdateAccountStatesInBackground(selectedAccountAddr?: string | null): Account[] {
    // We used to update all accounts in background, but now we only update the selected one
    const selectedAccData = this.accounts.find((account) => {
      return account.addr === selectedAccountAddr
    })
    if (!selectedAccData) return []

    return [selectedAccData]
  }

  async #load() {
    await this.#featureFlags?.initialLoadPromise
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
    // --------------------------------------------------
    this.accountStateInitialLoadPromise = this.updateAccountStates(
      this.#getAccountsToUpdateAccountStatesInBackground(initialSelectedAccountAddr)
    ).finally(() => {
      this.accountStateInitialLoadPromise = undefined
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

  /**
   * Fetches the on-chain state of one account.
   * - Use `'pending'` when the result must count
   * transactions that are not mined yet, such as the nonce for a new op or a check that stops a
   * second Safe deployment. Also use it right after a receipt, as on flashblocks networks the
   * receipt arrives before the latest block has the transaction.
   * - Use `'latest'` for background refreshes and for facts that must already
   * be mined. `'pending'` differs from `'latest'` only on Ethereum and `FLASHBLOCKS_CHAIN_IDS`,
   * see `getPendingBlockTagIfSupported`.
   * - Pass `force` when a transaction or a nonce error changed the
   * state, so a fetch that started before the call is not enough.
   */
  async updateAccountState(
    accountAddr: Account['addr'],
    blockTag: AccountStateBlockTag = 'latest',
    networks: bigint[] = [],
    force = false
  ) {
    await this.initialLoadPromise

    const accountData = this.accounts.find((account) => account.addr === accountAddr)
    if (!accountData) return
    await this.updateAccountStates([accountData], blockTag, networks, force)
  }

  private async updateAccountStates(
    accounts: Account[],
    blockTag: AccountStateBlockTag = 'latest',
    updateOnlyNetworksWithIds: bigint[] = [],
    force = false
  ) {
    if (!accounts.length) return

    // if any, update the account state only for the passed networks; else - all
    const updateOnlyPassedNetworks = updateOnlyNetworksWithIds.length
    const networksToUpdate = this.#networks.networks.filter((network) => {
      if (!updateOnlyPassedNetworks) return true

      return updateOnlyNetworksWithIds.includes(network.chainId)
    })
    const addrs = accounts.map(({ addr }) => addr)

    let readyNetworks = 0

    const networkUpdates = networksToUpdate.map(async (network) => {
      await this.#queueFetchJob(network, addrs, blockTag, force)
      readyNetworks++

      const areAllReady = readyNetworks === networksToUpdate.length
      // Prevent spamming updates as users may have dozens of networks and updating
      // every tick causes a lot of rerenders in the UI
      this.emitUpdate({ throttleMs: areAllReady ? 0 : 200 })
    })
    // After the jobs are queued, so areAccountStatesLoading is already true
    this.emitUpdate()

    await Promise.all(networkUpdates)

    this.#onAccountStateUpdate()
  }

  /**
   * Fetches the states of `addrs` on `network` after the earlier jobs of the same accounts.
   * Jobs for other accounts run at the same time. Never rejects, as a rejected job would also
   * reject every later job of the same accounts.
   */
  async #queueFetchJob(
    network: Network,
    addrs: Account['addr'][],
    requestedBlockTag: AccountStateBlockTag,
    force: boolean
  ) {
    const chainIdKey = network.chainId.toString()
    const calledAt = ++this.#sequence
    const blockTag =
      requestedBlockTag === 'pending' ? getPendingBlockTagIfSupported(network) : 'latest'

    if (!this.#fetchTrackers[chainIdKey]) this.#fetchTrackers[chainIdKey] = {}
    const chainTrackers = this.#fetchTrackers[chainIdKey]
    const queuedAccounts: QueuedAccountStateFetch[] = addrs.map((addr) => {
      if (!chainTrackers[addr]) {
        chainTrackers[addr] = { lastJob: Promise.resolve(), lastFetchStarted: {} }
      }
      const tracker = chainTrackers[addr]
      // Without force, the fetch that runs now is enough. With force, only a later fetch is.
      const runningFetch = tracker.runningFetch
      const canUseRunningFetch =
        !force && !!runningFetch && isBlockTagCovered(runningFetch.blockTag, blockTag)

      return { addr, tracker, coveredFrom: canUseRunningFetch ? runningFetch.startedAt : calledAt }
    })

    const previousJobs = queuedAccounts.map(({ tracker }) => tracker.lastJob)
    const job = Promise.all(previousJobs).then(() =>
      this.#runFetchJob(network, blockTag, queuedAccounts)
    )
    queuedAccounts.forEach(({ tracker }) => {
      tracker.lastJob = job
    })

    await job

    queuedAccounts.forEach(({ addr, tracker }) => {
      if (tracker.lastJob !== job) return
      delete chainTrackers[addr]
    })
    if (!Object.keys(chainTrackers).length) delete this.#fetchTrackers[chainIdKey]
  }

  async #runFetchJob(
    network: Network,
    blockTag: AccountStateBlockTag,
    queuedAccounts: QueuedAccountStateFetch[]
  ) {
    const chainIdKey = network.chainId.toString()
    // Read the accounts now, as the keys or the Safe data may have changed while the job waited
    const accountsByAddr = new Map(this.accounts.map((account) => [account.addr, account]))
    const accountsToFetch = queuedAccounts.flatMap((queuedAccount) => {
      const account = accountsByAddr.get(queuedAccount.addr)
      if (!account) return []
      if (this.#isCoveredByStartedFetch(queuedAccount, blockTag)) return []

      return [{ ...queuedAccount, account }]
    })
    if (!accountsToFetch.length) return

    const provider = this.#providers.providers[chainIdKey]
    if (!provider) {
      const error = new Error(`Provider not found for network ${chainIdKey}`)
      this.emitError({
        message: error.message,
        level: 'silent',
        sendCrashReport: true,
        error
      })
      return
    }

    const startedAt = ++this.#sequence
    accountsToFetch.forEach(({ tracker }) => {
      tracker.lastFetchStarted[blockTag] = startedAt
      tracker.runningFetch = { startedAt, blockTag }
    })

    try {
      const networkAccountStates = await getAccountState(
        provider,
        network,
        accountsToFetch.map(({ account }) => account),
        this.#keystore.keys,
        blockTag
      )

      this.#updateProviderIsWorking(network.chainId, true)

      networkAccountStates.forEach((accountState) =>
        this.#saveAccountState(chainIdKey, blockTag, accountState)
      )
    } catch (err: any) {
      this.emitError({
        level: 'silent',
        message: `Failed to update account state for ${network.name}`,
        error: err
      })
      this.#updateProviderIsWorking(network.chainId, false)
    } finally {
      accountsToFetch.forEach(({ tracker }) => {
        tracker.runningFetch = undefined
      })
    }
  }

  /** A failed fetch also covers the account, so queued calls don't each wait for a down RPC. */
  #isCoveredByStartedFetch(
    { tracker, coveredFrom }: QueuedAccountStateFetch,
    blockTag: AccountStateBlockTag
  ): boolean {
    const { latest = 0, pending = 0 } = tracker.lastFetchStarted
    const lastCoveringFetchStart = blockTag === 'pending' ? pending : Math.max(latest, pending)

    return lastCoveringFetchStart >= coveredFrom
  }

  #saveAccountState(
    chainIdKey: string,
    blockTag: AccountStateBlockTag,
    accountState: AccountOnchainState
  ) {
    const addr = accountState.accountAddr
    // The account was removed while its state was being fetched
    if (!this.accounts.some((account) => account.addr === addr)) return
    if (!this.accountStates[addr]) this.accountStates[addr] = {}

    // if the block tag is pending & we already have a state from a newer block,
    // we keep it. We do this because rogue RPCs sometimes mess up the pending state.
    // A pending result from the same block is saved, as the pending block can change
    // without a new block number. On flashblocks networks the pending block number lags
    // the state it reads, so it can't be compared, see FLASHBLOCKS_CHAIN_IDS.
    // Other results need no block check, as the queue saves them in call order
    const current = this.accountStates[addr][chainIdKey]
    const isPendingBlockComparable = !FLASHBLOCKS_CHAIN_IDS.includes(BigInt(chainIdKey))
    if (
      blockTag === 'pending' &&
      isPendingBlockComparable &&
      current &&
      current.currentBlock > accountState.currentBlock
    ) {
      return
    }

    this.accountStates[addr][chainIdKey] = accountState
  }

  async #addAccounts(accounts: Account[] = []) {
    if (!accounts.length) return

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
        ),
        safeCreation:
          acc.safeCreation ?? newAccountsAlreadyAdded.find((x) => x.addr === acc.addr)?.safeCreation
      })),
      ...newAccountsNotAddedYet.map((a) => ({ ...a, newlyAdded: true }))
    ]

    this.accounts = getUniqueAccountsArray(nextAccounts)
    await this.#storage.set('accounts', this.accounts)

    // we add newAccountsNotAddedYet first so the extension selects
    // a newly imported account first
    this.#onAddAccounts([...newAccountsNotAddedYet, ...newAccountsAlreadyAdded])

    // update the state of new accounts. Otherwise, the user needs to restart his extension
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.updateAccountStates(newAccountsNotAddedYet)

    this.emitUpdate()
  }

  async addAccounts(accounts: Account[] = []) {
    await this.withStatus('addAccounts', async () => this.#addAccounts(accounts), true)
  }

  removeAccountData(address: Account['addr']) {
    this.accounts = this.accounts.filter((acc) => acc.addr !== address)

    delete this.accountStates[address]

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
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

  /** Saves recovered Safe creation data on an imported account. */
  async updateSafeCreation(addr: Account['addr'], safeCreation: SafeAccountCreation) {
    const accountIndex = this.accounts.findIndex((account) => account.addr === addr)
    if (accountIndex === -1) return

    this.accounts = this.accounts.map((account, index) =>
      index === accountIndex ? { ...account, safeCreation } : account
    )
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
    return Object.keys(this.#fetchTrackers).length > 0
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
  async getOrFetchAccountOnChainState(
    addr: string,
    chainId: bigint
  ): Promise<AccountOnchainState | undefined> {
    if (!this.accountStates[addr]?.[chainId.toString()]) {
      await this.updateAccountState(addr, 'latest', [chainId])
    }

    return this.accountStates[addr]?.[chainId.toString()]
  }

  resetAccountsNewlyAddedState() {
    this.accounts = this.accounts.map((a) => ({ ...a, newlyAdded: false }))
    this.emitUpdate()
  }

  async setViewOnlyAccountIdentitiesIfNeeded(): Promise<void> {
    if (this.#featureFlags?.isFeatureEnabled('ambireSmartAccounts') === false) {
      return this.#viewOnlyAccountGetIdentityInterval.stop()
    }

    const viewOnlyAccountsNeedingIdentityFetch = this.accounts.filter(
      (a) => !this.#keystore.getAccountKeys(a).length && !a.identityFetchedAt && !a.safeCreation
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
    if (this.#featureFlags?.isFeatureEnabled('ambireSmartAccounts') === false) {
      return this.#smartAccountIdentityCreateInterval.stop()
    }

    const smartAccountsNeedingIdentityCreate = this.accounts.filter(
      (a) =>
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
