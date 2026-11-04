import EmittableError from '../../classes/EmittableError'
import {
  getPrivacyPoolsAsset,
  getPrivacyPoolsChainConfig,
  isPrivacyPoolsNativeAsset,
  PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY,
  PRIVACY_POOLS_SUPPORTED_CHAIN_IDS
} from '../../consts/privacyPools'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { Fetch } from '../../interfaces/fetch'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import {
  IPrivacyPoolsController,
  PrivacyPoolsAccount,
  PrivacyPoolsAccountChainState,
  PrivacyPoolsChainPoolStats,
  PrivacyPoolsChainState,
  PrivacyPoolsDepositAssetConfig,
  PrivacyPoolsHistoryFilters,
  PrivacyPoolsHistorySession,
  PrivacyPoolsOperation,
  PrivacyPoolsRagequitDeposit,
  PrivacyPoolsSendForm,
  PrivacyPoolsTokenBalance,
  PrivacyPoolsUnavailableReason
} from '../../interfaces/privacyPools'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import { IUiController, View } from '../../interfaces/ui'
import { AccountOpStatus, Call } from '../../libs/accountOp/types'
import { createKohakuStorage } from '../../libs/kohaku/host'
import { fetchPrivacyPoolsPrices, getPrivacyPoolsPriceKey } from '../../libs/privacyPools/prices'
import {
  createProverFactory,
  PrivacyPoolsProverFactory,
  withCancellableProving
} from '../../libs/privacyPools/prover'
import { Pagination } from '../../utils/paginate'
import EventEmitter from '../eventEmitter/eventEmitter'
import { PrivacyPoolsBuiltCalls } from './builtCalls'
import {
  LockGeneration,
  PendingAccountOp,
  PhraseScopedModule,
  PrivacyPoolsContext
} from './context'
import { PrivacyPoolsDepositParams, PrivacyPoolsDeposits } from './deposits'
import { privacyPoolsErrors } from './errors'
import { PrivacyPoolsHistory } from './history'
import { PrivacyPoolsPoolStatsReader } from './poolStats'
import { PrivacyPoolsProtocolRegistry } from './protocolRegistry'
import { PrivacyPoolsRagequit } from './ragequit'
import { PrivacyPoolsSendFormState } from './sendForm'
import { PrivacyPoolsSync } from './sync'
import { PrivacyPoolsWatches, Watch } from './watches'
import {
  PrivacyPoolsBroadcastAttempt,
  PrivacyPoolsWithdrawal,
  PrivacyPoolsWithdrawalParams
} from './withdrawal'

const PRICES_MAX_AGE_MS = 5 * 60 * 1000

/** A chain read more recently than this is not read again when the account is opened. */
export const OPEN_SYNC_MAX_AGE_MS = 2 * 60 * 1000

/**
 * Privacy Pools state: one plugin per (chain, recovery phrase) and its notes. Scoped by phrase, as note secrets are derived from it - accounts without one (hardware,
 * private key, view-only) cannot use Privacy Pools.
 *
 * The work is done by modules (plugins, sync, history, deposits, withdrawal, Send form) holding
 * their own state. This stays the only `EventEmitter`: it checks what is available, wires the
 * modules together and reports their state to the UI. See `PrivacyPoolsContext`.
 */
export class PrivacyPoolsController extends EventEmitter implements IPrivacyPoolsController {
  #keystore: IKeystoreController

  #featureFlags: IFeatureFlagsController

  #networks: INetworksController

  #providers: IProvidersController

  #selectedAccount: ISelectedAccountController

  #storage: IStorageController

  #ui: IUiController

  #fetch: Fetch

  /** Lets the selection move off a removed account. Also fired when a phrase is deleted. */
  #onAccountsRemoved: (seedIds: string[]) => Promise<void>

  #lock = new LockGeneration()

  #registry: PrivacyPoolsProtocolRegistry

  #sync: PrivacyPoolsSync

  #deposits: PrivacyPoolsDeposits

  #withdrawal: PrivacyPoolsWithdrawal

  #ragequit: PrivacyPoolsRagequit

  #builtCalls: PrivacyPoolsBuiltCalls

  #watches: PrivacyPoolsWatches

  #poolStatsReader: PrivacyPoolsPoolStatsReader

  /** Per chain, the latest `#refreshPoolStats`, so an older one finishing later writes nothing. */
  #poolStatsRefreshIds: { [chainId: string]: number } = {}

  #sendForm: PrivacyPoolsSendFormState

  #history: PrivacyPoolsHistory

  /** In teardown order: a withdrawal being proved is cancelled before its plugin is dropped. */
  #phraseScopedModules: PhraseScopedModule[]

  #unsubscribers: (() => void)[] = []

  /** The selected Privacy Pools account the UI last heard of. See `#subscribeToDependencies`. */
  #selectedAccountId: string | null = null

  /** Whether the selected account could be read in the background when the keystore last updated. */
  #wasSyncable = false

  /**
   * USD prices of the pools' assets, keyed by `getPrivacyPoolsPriceKey`. Not from the portfolio,
   * which has no selected account while a Privacy Pools account is selected.
   */
  prices: { [priceKey: string]: number } = {}

  #pricesFetchedAt = 0

  #pricesRequest: Promise<void> | null = null

  /**
   * Per chain, its pools' numbers for a token's details, so they are there when it opens. The same
   * for every account, so they outlive a lock. Computed from this device's copy of the history
   * after each sync of it, before the balances it reads show - see `PrivacyPoolsPoolStatsReader`.
   * Not on load: a stored history is read only when the user opens a Privacy Pools account.
   */
  poolStats: { [chainId: string]: PrivacyPoolsChainPoolStats } = {}

  /** At most one per stored recovery phrase, and removed with it. */
  accounts: PrivacyPoolsAccount[] = []

  initialLoadPromise?: Promise<void>

  constructor({
    keystore,
    featureFlags,
    networks,
    providers,
    selectedAccount,
    storage,
    ui,
    fetch,
    circuitsBaseUrl,
    proverFactory,
    onAccountsRemoved,
    getPendingAccountOps,
    eventEmitterRegistry
  }: {
    keystore: IKeystoreController
    featureFlags: IFeatureFlagsController
    networks: INetworksController
    providers: IProvidersController
    selectedAccount: ISelectedAccountController
    storage: IStorageController
    ui: IUiController
    fetch: Fetch
    /** Where the circuit artifacts are served from, as only the platform knows it. */
    circuitsBaseUrl: string
    /**
     * Proves outside this context (the extension's multi-threaded offscreen document). Absent,
     * proofs run here from `circuitsBaseUrl`.
     */
    proverFactory?: PrivacyPoolsProverFactory
    onAccountsRemoved: (seedIds: string[]) => Promise<void>
    /** The transactions broadcast but not confirmed, and the current request batch. */
    getPendingAccountOps: () => PendingAccountOp[]
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)
    this.#keystore = keystore
    this.#featureFlags = featureFlags
    this.#networks = networks
    this.#providers = providers
    this.#selectedAccount = selectedAccount
    this.#storage = storage
    this.#ui = ui
    this.#fetch = fetch
    this.#onAccountsRemoved = onAccountsRemoved

    const ctx: PrivacyPoolsContext = {
      keystore,
      featureFlags,
      networks,
      providers,
      fetch,
      kohakuStorage: createKohakuStorage({
        storage,
        storageKey: 'privacyPoolsState',
        onError: (error, message) =>
          this.emitError({
            message:
              message || 'Privacy Pools could not save its progress. It will be rebuilt next time.',
            level: 'silent',
            error: error instanceof Error ? error : new Error('privacyPools: storage write failed')
          })
      }),
      lock: this.#lock,
      hasAccount: (seedId) => this.#hasAccount(seedId),
      getPendingAccountOps,
      getTokenPrice: (chainId, tokenAddress) =>
        this.prices[getPrivacyPoolsPriceKey(chainId, tokenAddress)] ?? null,
      emitUpdate: () => this.emitUpdate(),
      emitError: (error) => this.emitError(error)
    }
    const cancellableProverFactory = withCancellableProving(
      proverFactory ?? createProverFactory(circuitsBaseUrl),
      // Read when a proof starts, by which time the withdrawal module exists. Only withdrawals
      // prove the 'withdraw' circuit; a ragequit's short 'commitment' proof is not cancelled.
      (circuit) => (circuit === 'withdraw' ? this.#withdrawal.provingSignal : null)
    )

    this.#registry = new PrivacyPoolsProtocolRegistry(ctx, cancellableProverFactory)
    this.#sync = new PrivacyPoolsSync(
      ctx,
      this.#registry,
      (chainId) => this.#refreshPoolStats(chainId),
      // Read when a sync asks, by which time the history module exists
      (seedId) => this.#history.hasSessions() && seedId === this.#getSelectedSeedId()
    )
    this.#builtCalls = new PrivacyPoolsBuiltCalls(ctx)
    this.#watches = new PrivacyPoolsWatches(this.#sync)
    this.#deposits = new PrivacyPoolsDeposits(
      ctx,
      this.#registry,
      this.#sync,
      this.#builtCalls,
      this.#watches
    )
    this.#withdrawal = new PrivacyPoolsWithdrawal(ctx, this.#registry, this.#sync)
    this.#ragequit = new PrivacyPoolsRagequit(ctx, this.#registry, this.#sync, this.#builtCalls)
    this.#poolStatsReader = new PrivacyPoolsPoolStatsReader(ctx)
    this.#sendForm = new PrivacyPoolsSendFormState(ui)
    this.#history = new PrivacyPoolsHistory(ctx, this.#sync, {
      getSupportedChainIds: () => this.supportedChainIds,
      syncChain: (chainId) => this.syncChain(chainId)
    })
    this.#phraseScopedModules = [
      this.#withdrawal,
      this.#watches,
      this.#builtCalls,
      this.#deposits,
      this.#sync,
      this.#registry
    ]

    this.#ui.uiEvent.on('addView', this.#onAddView)
    this.#ui.uiEvent.on('updateView', this.#onUpdateView)
    this.#ui.uiEvent.on('removeView', this.#onRemoveView)

    // Cleared when done so the resolved promise isn't carried in the state sent to the UI.
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    // What `supportedChainIds` and `unavailableReason` read, or the UI briefly shows unavailable
    await this.#networks.initialLoadPromise
    await this.#providers.initialLoadPromise
    await this.#keystore.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise

    this.accounts = await this.#storage.get(PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY, [])
    // Phrases deleted while this controller was not running
    await this.#forgetAccountsOfDeletedSeeds()

    this.#subscribeToDependencies()
    this.emitUpdate()
  }

  /**
   * Recomputes a chain's pool numbers from its history on this device. Does not emit: a sync
   * emits once it is done. Never rejects.
   */
  async #refreshPoolStats(chainId: string): Promise<void> {
    const refreshId = (this.#poolStatsRefreshIds[chainId] || 0) + 1
    this.#poolStatsRefreshIds[chainId] = refreshId
    const isLatest = () => this.#poolStatsRefreshIds[chainId] === refreshId

    try {
      const byToken = await this.#poolStatsReader.read(chainId)
      // Before the chain's first sync there is nothing to show yet, not an error
      if (!byToken || !isLatest()) return

      this.poolStats = { ...this.poolStats, [chainId]: { byToken, error: null } }
    } catch (error: any) {
      const emittableError = privacyPoolsErrors.poolStatsReadFailed(error)
      this.emitError(emittableError)
      if (!isLatest()) return

      this.poolStats = {
        ...this.poolStats,
        [chainId]: { byToken: {}, error: emittableError.message }
      }
    }
  }

  /**
   * Each subscription invalidates a plugin or changes what the getters report. Updates are passed
   * on only when they can change what this reports, as selected account and networks update often.
   */
  #subscribeToDependencies() {
    this.#selectedAccountId = this.#selectedAccount.privacyPoolsAccountId
    this.#wasSyncable = !!this.#getBackgroundSyncSeedId()

    this.#unsubscribers.push(
      this.#keystore.onUpdate((forceEmit) => {
        // Nothing derived from the phrase, notes included, may outlive the lock
        if (!this.#keystore.isUnlocked && this.#hasPhraseDerivedState()) this.#teardown()

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#forgetAccountsOfDeletedSeeds()

        // On unlocking, and once the phrase is backed up, what opening the account could not read
        const isSyncable = !!this.#getBackgroundSyncSeedId()
        if (isSyncable && !this.#wasSyncable) this.#syncOnOpen()
        this.#wasSyncable = isSyncable

        this.#propagateIfHasAccounts(forceEmit)
      }, 'privacyPools'),

      // Switching accounts drops nothing: each phrase keeps its plugins and notes, and a running
      // sync of the previous one still warms the chain's history
      this.#selectedAccount.onUpdate((forceEmit) => {
        const selectedAccountId = this.#selectedAccount.privacyPoolsAccountId
        if (selectedAccountId === this.#selectedAccountId) return

        this.#selectedAccountId = selectedAccountId
        // The form it was proved from is gone; one being sent finishes, hidden
        this.#withdrawal.dropUnsent()
        this.#sendForm.clear()
        if (selectedAccountId) this.#syncOnOpen()
        this.propagateUpdate(forceEmit)
      }, 'privacyPools'),

      this.#providers.onUpdate((forceEmit) => {
        this.#registry.dropStaleProviders()

        this.#propagateIfHasAccounts(forceEmit)
      }, 'privacyPools'),

      // Only so `supportedChainIds` and what derives from it reach the UI
      this.#networks.onUpdate(
        (forceEmit) => this.#propagateIfHasAccounts(forceEmit),
        'privacyPools'
      ),

      this.#featureFlags.onUpdate((forceEmit) => {
        if (!this.#featureFlags.isFeatureEnabled('tokenPrices')) this.#dropPrices()

        this.#propagateIfHasAccounts(forceEmit)
      }, 'privacyPools')
    )
  }

  /** Without a Privacy Pools account, nothing this controller reports depends on the others. */
  #propagateIfHasAccounts(forceEmit?: boolean) {
    if (this.accounts.length) this.propagateUpdate(forceEmit)
  }

  /** The SDK's supported chains, narrowed to the user's networks that have a provider. */
  get supportedChainIds(): string[] {
    return PRIVACY_POOLS_SUPPORTED_CHAIN_IDS.map((chainId) => chainId.toString()).filter(
      (chainId) =>
        this.#networks.networks.some((network) => network.chainId.toString() === chainId) &&
        !!this.#providers.providers[chainId]
    )
  }

  get unavailableReason(): PrivacyPoolsUnavailableReason | null {
    // Before 'locked', which unlocking would not fix while these hold
    if (!this.#getSelectedSeedId()) return 'no-account'
    if (!this.supportedChainIds.length) return 'unsupported-network'
    if (!this.#keystore.isUnlocked) return 'locked'

    return null
  }

  get isAvailableForSelectedAccount(): boolean {
    return !this.unavailableReason
  }

  /** Per chain: the selected account's sync of it, with what this device knows of its shared state. */
  get chains(): { [chainId: string]: PrivacyPoolsChainState } {
    return this.#sync.getChainStates(this.#getSelectedSeedId(), this.supportedChainIds)
  }

  /**
   * The withdrawal in flight, or the last one until dismissed. Hidden, not dropped, while another
   * phrase is selected: one being sent cannot be stopped, and switching back must show how it
   * went. One not sent yet is dropped on switching - see `PrivacyPoolsWithdrawal.dropUnsent`.
   */
  get operation(): PrivacyPoolsOperation | null {
    const { operation } = this.#withdrawal
    if (operation?.seedId !== this.#getSelectedSeedId()) return null

    return operation
  }

  /** Whether any chain has completed a scan for the selected phrase. */
  get hasSyncedAnyChain(): boolean {
    return Object.values(this.chains).some((chain) => !!chain.lastSyncedAt)
  }

  /**
   * One row per token per chain. Only `approvedAmount` can be withdrawn; the rest awaits the
   * association set and can only be reclaimed publicly. What a deposit, withdrawal or ragequit is
   * still moving is in `simulationAmount` and `approvedAmountPostSimulation`, not in the notes'
   * amounts yet - so a token with only an arriving deposit has a row too.
   */
  get balances(): { [chainId: string]: PrivacyPoolsTokenBalance[] } {
    const seedId = this.#getSelectedSeedId()
    const accountChains = this.#getSelectedAccountStates()

    return Object.fromEntries(
      Object.keys(this.chains).map((chainId) => {
        const byToken = new Map<string, PrivacyPoolsTokenBalance>()

        const getEntry = (key: string): PrivacyPoolsTokenBalance => {
          const existing = byToken.get(key)
          if (existing) return existing

          const asset = getPrivacyPoolsAsset(BigInt(chainId), key)
          const entry = {
            tokenAddress: key,
            // A pool added before we list it: show the raw amount rather than hide the balance
            symbol: asset?.symbol || 'Unknown token',
            decimals: asset?.decimals ?? 0,
            isNative: asset?.isNative ?? isPrivacyPoolsNativeAsset(key),
            approvedAmount: 0n,
            pendingAmount: 0n,
            totalAmount: 0n,
            simulationAmount: 0n,
            approvedAmountPostSimulation: 0n
          }
          byToken.set(key, entry)

          return entry
        }

        ;(accountChains[chainId]?.notes || []).forEach((note) => {
          const entry = getEntry(note.tokenAddress.toLowerCase())

          if (note.approval === 'approved') {
            entry.approvedAmount += note.amount
            entry.approvedAmountPostSimulation += note.amount
          } else entry.pendingAmount += note.amount

          entry.totalAmount += note.amount
        })

        const changeAmounts = seedId ? this.#watches.getChangeAmounts(seedId, chainId) : {}
        Object.entries(changeAmounts).forEach(
          ([tokenAddress, { simulationAmount, withdrawingAmount }]) => {
            const entry = getEntry(tokenAddress)
            const approvedAmountPostSimulation = entry.approvedAmount - withdrawingAmount

            entry.simulationAmount = simulationAmount
            // Not below zero, as a sync ahead of what was expected must not show a negative amount
            entry.approvedAmountPostSimulation =
              approvedAmountPostSimulation > 0n ? approvedAmountPostSimulation : 0n
          }
        )

        return [chainId, [...byToken.values()]]
      })
    )
  }

  /**
   * The selected account's history, one page per screen showing it. Read only while a screen shows
   * it, along with each sync - see `filterHistory`.
   */
  get history(): { [sessionId: string]: PrivacyPoolsHistorySession } {
    return this.#history.getSessions(this.#getSelectedSeedId())
  }

  /** Entrypoint deposit requirements per `${chainId}:${tokenAddress}` (lowercase), read once. */
  get depositAssetConfigs(): { [key: string]: PrivacyPoolsDepositAssetConfig } {
    return this.#deposits.assetConfigs
  }

  /** The selected account's Send form. Dropped on switching accounts, like the regular one. */
  get sendForm(): PrivacyPoolsSendForm {
    return this.#sendForm.form
  }

  /** Changes when the form is cleared here, so the screen drops what it holds locally. */
  get sendFormResetCounter(): number {
    return this.#sendForm.resetCounter
  }

  /** Whether the Send form has anything the user would lose. Reopens the popup on that screen. */
  get hasPersistedSendForm(): boolean {
    return this.#sendForm.hasPersistedForm
  }

  /** The selected Privacy Pools account's phrase, or null if none or its account/phrase is gone. */
  #getSelectedSeedId(): string | null {
    const seedId = this.#selectedAccount.privacyPoolsAccountId
    if (!seedId) return null
    if (!this.accounts.some((account) => account.seedId === seedId)) return null
    if (!this.#keystore.seeds.some((seed) => seed.id === seedId)) return null

    return seedId
  }

  #getSelectedAccountStates(): { [chainId: string]: PrivacyPoolsAccountChainState } {
    const seedId = this.#getSelectedSeedId()

    return seedId ? this.#sync.getAccountChainStates(seedId) : {}
  }

  #hasAccount(seedId: string) {
    return this.accounts.some((account) => account.seedId === seedId)
  }

  #assertAvailableAndGetSeedId(): string {
    const reason = this.unavailableReason

    if (reason === 'no-account') throw privacyPoolsErrors.noAccountSelected()

    if (reason === 'unsupported-network') throw privacyPoolsErrors.noSupportedNetwork()

    if (reason === 'locked') throw privacyPoolsErrors.locked()

    const seedId = this.#getSelectedSeedId()
    if (!seedId) throw privacyPoolsErrors.unavailableForAccount()

    return seedId
  }

  /**
   * Reads a chain's notes for the selected account, beside the syncs of other accounts and chains.
   * A repeat call joins the running one - see `PrivacyPoolsSync.queue`.
   */
  async syncChain(chainId: string): Promise<void> {
    const seedId = this.#assertAvailableAndGetSeedId()
    // Prices are refreshed along with balances
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#refreshPrices()

    return this.#sync.queue(chainId, seedId)
  }

  /** Refetches stale prices, one request at a time, unless token prices are opted out of. */
  async #refreshPrices() {
    if (!this.#featureFlags.isFeatureEnabled('tokenPrices')) return
    if (this.#pricesRequest || Date.now() - this.#pricesFetchedAt < PRICES_MAX_AGE_MS) return

    this.#pricesRequest = (async () => {
      try {
        const prices = await fetchPrivacyPoolsPrices({
          fetch: this.#fetch,
          networks: this.#networks.networks.filter(({ chainId }) =>
            this.supportedChainIds.includes(chainId.toString())
          )
        })
        // Opted out while the request was in flight
        if (!this.#featureFlags.isFeatureEnabled('tokenPrices')) return

        this.prices = prices
        this.#pricesFetchedAt = Date.now()
        this.emitUpdate()
      } catch (error: any) {
        // Previous prices, if any, stay
        this.emitError({
          level: 'silent',
          message: 'Could not load the prices of what is in Privacy Pools.',
          error: error instanceof Error ? error : new Error('privacyPools: prices request failed')
        })
      } finally {
        this.#pricesRequest = null
      }
    })()

    await this.#pricesRequest
  }

  #dropPrices() {
    this.prices = {}
    this.#pricesFetchedAt = 0
  }

  /**
   * Syncs every supported chain for the selected phrase, however fresh (a refresh).
   *
   * Not in `withStatus`, which refuses a call while the previous one runs: a first read takes
   * minutes, and another account opened meanwhile must still start its sync. Progress is per
   * chain, through `chains`.
   */
  async sync(): Promise<void> {
    try {
      await Promise.all(this.supportedChainIds.map((chainId) => this.syncChain(chainId)))
    } catch (error: any) {
      this.#emitSyncError(error)
    }
  }

  /** Whether a deposit, withdrawal or ragequit is waiting to show in an account's notes. */
  get hasSyncWatches(): boolean {
    return this.#watches.hasWatches
  }

  /**
   * One round of the background sync, run by the timer of `ContinuousUpdatesController`: the
   * watches, if any, and the selected account's chains, in parallel. While watches keep the timer
   * fast, the account only syncs the chains older than `OPEN_SYNC_MAX_AGE_MS`. A chain a watch is
   * syncing is not synced twice, as `PrivacyPoolsSync.queue` joins the running sync. Never
   * rejects, as the syncs do not - a failure shows in the chain's state.
   */
  async syncInBackground(): Promise<void> {
    const hasWatches = this.#watches.hasWatches

    await Promise.all([
      hasWatches ? this.#syncWatches() : Promise.resolve(),
      this.#syncSelectedAccountChains(hasWatches ? OPEN_SYNC_MAX_AGE_MS : undefined)
    ])
  }

  /**
   * Syncs the selected account's chains, or only those not read in the last `maxAgeMs`. Not in
   * `withStatus`, as `sync`. Skipped until the phrase, the only way to recover the account, is
   * backed up: the dashboard asks for it before the minutes-long first read.
   */
  async #syncSelectedAccountChains(maxAgeMs?: number): Promise<void> {
    const seedId = this.#getBackgroundSyncSeedId()
    if (!seedId) return

    const accountChains = this.#sync.getAccountChainStates(seedId)
    const chainIds = this.supportedChainIds.filter((chainId) => {
      if (maxAgeMs === undefined) return true

      const lastSyncedAt = accountChains[chainId]?.lastSyncedAt

      return !lastSyncedAt || Date.now() - lastSyncedAt >= maxAgeMs
    })
    if (!chainIds.length) return

    // Prices are refreshed along with balances
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#refreshPrices()

    await Promise.all(chainIds.map((chainId) => this.#sync.queue(chainId, seedId)))
  }

  /** On a view opening or the account being selected, reads what is older than a short while. */
  #syncOnOpen() {
    if (!this.#ui.views.length) return

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#syncSelectedAccountChains(OPEN_SYNC_MAX_AGE_MS)
  }

  /** The selected account's phrase when its chains may be read in the background now. */
  #getBackgroundSyncSeedId(): string | null {
    const seedId = this.#getSelectedSeedId()
    if (!seedId || this.unavailableReason) return null

    return this.#isSeedBackedUp(seedId) ? seedId : null
  }

  #isSeedBackedUp(seedId: string) {
    return this.#keystore.seeds.some((seed) => seed.id === seedId && !seed.notBackedUp)
  }

  /** Whether a watch may sync now: unlocked, on a network the user still has, phrase backed up. */
  #canWatchSync({ seedId, chainId }: Watch) {
    return (
      this.#keystore.isUnlocked &&
      this.#hasAccount(seedId) &&
      this.#isSeedBackedUp(seedId) &&
      this.supportedChainIds.includes(chainId)
    )
  }

  /**
   * One sync of every watch. Tells the timer once the last one is over, and the UI whenever a
   * watch or a change ends.
   */
  async #syncWatches() {
    const hasEnded = await this.#watches.syncAll((watch) => this.#canWatchSync(watch))

    if (hasEnded) this.emitUpdate()
  }

  /**
   * Syncs an account's chain at once, and on every round of the timer after, until its notes differ
   * from `baseline` and the changes sent are shown, or the watch runs out of time. Resolves after
   * the first sync. `expectedChangeId` is the change this one is for, if one was recorded - see
   * `PrivacyPoolsWatches.expectChange`.
   */
  async #watchChange({
    seedId,
    chainId,
    baseline,
    hasDeposit,
    expectedChangeId
  }: {
    seedId: string
    chainId: string
    baseline: string | null
    hasDeposit: boolean
    expectedChangeId: number | null
  }): Promise<void> {
    if (!this.#hasAccount(seedId)) return

    // `onAccountOpFinalized` can run while locked, when the notes of a phrase must not be held.
    // A watch without a baseline ends after its first sync, which waits for the unlock.
    this.#watches.start({
      seedId,
      chainId,
      baseline: this.#keystore.isUnlocked ? baseline : null,
      hasDeposit,
      expectedChangeId
    })
    // Wakes the timer
    this.emitUpdate()

    await this.#syncWatches()
  }

  /**
   * Opens a screen's page of the selected account's history, or moves it to another page or
   * network. Reads the history of the networks shown whose last sync did not read it, without
   * syncing them again unless their current plugin has not synced - see
   * `PrivacyPoolsHistory.load`. The page arrives in `history`. The screen closes it with
   * `resetHistoryFilters`.
   */
  async filterHistory(
    sessionId: string,
    filters?: PrivacyPoolsHistoryFilters,
    pagination?: Pagination
  ): Promise<void> {
    this.#history.open(sessionId, filters, pagination)

    await this.#loadHistory(filters)
  }

  /** Closes a screen's page of the history. Syncs stop reading it once no screen shows it. */
  resetHistoryFilters(sessionId: string) {
    this.#history.close(sessionId)
  }

  async #loadHistory(filters: PrivacyPoolsHistoryFilters = {}) {
    const seedId = this.#getSelectedSeedId()
    if (!seedId || !this.isAvailableForSelectedAccount) return
    // Like the background sync: the first read waits for the phrase to be backed up
    if (this.#keystore.seeds.find(({ id }) => id === seedId)?.notBackedUp) return

    try {
      await this.#history.load(seedId, filters)
    } catch (error: any) {
      this.#emitSyncError(error)
    }
  }

  #emitSyncError(error: any) {
    if (error instanceof EmittableError) {
      this.emitError(error)
      return
    }

    this.emitError({
      message: 'Could not load your Privacy Pools balance. Please try again.',
      level: 'major',
      error: error instanceof Error ? error : new Error('privacyPools: sync failed')
    })
  }

  /**
   * Builds the deposit calls from a wallet account into a Privacy Pools account, for the regular
   * signing flow. Tracked only once broadcast - see `onAccountOpBroadcast`. Deposits are public:
   * the pool stores and emits the sender's address.
   */
  async buildDepositCalls(params: PrivacyPoolsDepositParams): Promise<Call[]> {
    const { seedId, chainId } = params
    await this.initialLoadPromise

    if (!this.#hasAccount(seedId)) throw privacyPoolsErrors.depositAccountRemoved(seedId)

    if (!this.#keystore.isUnlocked) throw privacyPoolsErrors.depositLocked()

    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config || !this.supportedChainIds.includes(chainId))
      throw privacyPoolsErrors.depositUnsupportedNetwork(chainId)

    return this.#deposits.buildCalls(params)
  }

  /** Reads the entrypoint's deposit requirements for an asset once, into `depositAssetConfigs`. */
  loadDepositAssetConfig(
    chainId: string,
    tokenAddress: string
  ): Promise<PrivacyPoolsDepositAssetConfig> {
    return this.#deposits.loadAssetConfig(chainId, tokenAddress)
  }

  /**
   * Records the account's notes as they are when a transaction with a deposit or ragequit this
   * wallet built is broadcast, however it was signed, and what it is expected to add to or take
   * from the account's total of the token, which the balances show meanwhile. Only calls
   * `buildDepositCalls` and `buildRagequitCalls` built are recognised - others are not this
   * wallet's. Nothing is persisted, as a local log would link deposits to their withdrawals.
   */
  onAccountOpBroadcast({ chainId, calls }: { chainId: bigint; calls: Call[] }) {
    let hasExpectedChange = false

    calls.forEach((call) =>
      this.#builtCalls.markBroadcast(
        chainId,
        call,
        ({ seedId, chainId: builtChainId, kind, tokenAddress, amount }) => {
          // Nothing derived from the phrase is read while locked
          if (!this.#keystore.isUnlocked) return { baseline: null, expectedChangeId: null }

          const expectedChangeId = this.#watches.expectChange({
            seedId,
            chainId: builtChainId,
            kind,
            tokenAddress,
            amount
          })
          if (expectedChangeId !== null) hasExpectedChange = true

          return {
            baseline: this.#watches.getFingerprint(seedId, builtChainId),
            expectedChangeId
          }
        }
      )
    )

    if (hasExpectedChange) this.emitUpdate()
  }

  /**
   * Called with every transaction once its outcome is known. One that landed starts a watch on each
   * account its deposit or ragequit changes, so the balance shows without the user asking. One
   * that did not frees its calls, which no longer hold up the next deposit, and stops showing what
   * they were to move.
   */
  onAccountOpFinalized({
    chainId,
    status,
    calls
  }: {
    chainId: bigint
    status?: AccountOpStatus
    calls: Call[]
  }) {
    if (
      !status ||
      status === AccountOpStatus.Pending ||
      status === AccountOpStatus.BroadcastedButNotConfirmed
    )
      return

    // A batch may be partly complete, and it may be the deposit that landed
    const hasLanded =
      status === AccountOpStatus.Success || status === AccountOpStatus.PartiallyComplete

    calls.forEach((call) => {
      const builtCall = this.#builtCalls.take(chainId, call)
      if (!builtCall) return

      const expectedChangeId = builtCall.broadcast?.expectedChangeId ?? null
      if (!hasLanded) {
        if (expectedChangeId !== null && this.#watches.dropChange(expectedChangeId))
          this.emitUpdate()

        return
      }

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.#watchChange({
        seedId: builtCall.seedId,
        chainId: builtCall.chainId,
        baseline: builtCall.broadcast?.baseline ?? null,
        hasDeposit: builtCall.kind === 'deposit',
        expectedChangeId
      })
    })
  }

  updateSendForm(update: Partial<PrivacyPoolsSendForm>) {
    this.#sendForm.update(update)
    this.emitUpdate()
  }

  resetSendForm() {
    if (this.#sendForm.clear()) this.emitUpdate()
  }

  /** Drops the form and the withdrawal proved, or being proved, from it. */
  #leaveSendForm() {
    const hasDroppedWithdrawal = this.#withdrawal.dropUnsent()
    const hasClearedForm = this.#sendForm.clear()

    if (hasDroppedWithdrawal || hasClearedForm) this.emitUpdate()
  }

  #onAddView = () => {
    this.#syncOnOpen()
  }

  #onUpdateView = (view: View) => {
    if (this.#sendForm.isLeftByViewUpdate(view)) this.#leaveSendForm()
    if (this.#sendForm.isTokenPickedByViewUpdate(view)) this.emitUpdate()
  }

  #onRemoveView = (view: View) => {
    if (this.#sendForm.isLeftByViewRemoval(view)) this.#leaveSendForm()
  }

  dismissOperation() {
    // `operation`, so another phrase's cannot be dismissed
    if (!this.operation) return

    if (this.#withdrawal.dismiss()) this.emitUpdate()
  }

  /**
   * Proves a withdrawal without sending it, so the user sees the fee before anything is sent.
   *
   * A single-use sender derived from the phrase submits an ERC-4337 userOp whose gas a paymaster
   * pays, taking a fee from the withdrawn amount - so no user-owned address pays gas.
   *
   * Not in `withStatus`: proving is long. Progress is in `operation`. Leaving the form cancels it -
   * see `PrivacyPoolsWithdrawal.dropUnsent`.
   */
  async prepareWithdrawal(params: PrivacyPoolsWithdrawalParams): Promise<void> {
    const seedId = this.#assertAvailableAndGetSeedId()

    await this.#withdrawal.prepare({ ...params, seedId })
  }

  /**
   * Runs the proved withdrawal again when its confirmation sheet opens a while after it was proved,
   * as in a popup reopened on it, so the sheet shows whether it still goes through and its fee as
   * of now. Like the regular Send's re-estimation. Sending checks it again if it is due by then.
   */
  async recheckWithdrawal(): Promise<void> {
    // `operation`, so another phrase's is left alone
    await this.#withdrawal.recheck(this.operation)
  }

  /**
   * Sends the signed withdrawal to the bundler and waits for it. Watches the account it came from
   * either way, as a userOp can land after the receipt wait gives up, or before our node sees it,
   * and reads the history along with the first sync. The balances count the amount as gone meanwhile. A
   * failed attempt keeps it counted until the watch ends, as it may still land.
   */
  async broadcastWithdrawal(): Promise<void> {
    // `operation`, so another phrase's cannot be sent
    const { operation } = this
    this.#withdrawal.assertReadyToSend(operation)
    this.#assertAvailableAndGetSeedId()

    const { seedId, chainId } = operation
    // Read before sending: after it, a sync may already show what the withdrawal changed
    const baseline = this.#watches.getFingerprint(seedId, chainId)
    // The whole amount leaves the notes, its fee included - see `readPaymasterWithdrawal`
    const expectedChangeId = this.#watches.expectChange({
      seedId,
      chainId,
      kind: 'withdrawal',
      tokenAddress: operation.tokenAddress,
      amount: -operation.amount
    })
    if (expectedChangeId !== null) this.emitUpdate()

    let attempt: PrivacyPoolsBroadcastAttempt | null = null
    try {
      attempt = await this.#withdrawal.broadcast(operation)
    } finally {
      // Not handed to the bundler, so nothing is on its way out
      if (!attempt && expectedChangeId !== null && this.#watches.dropChange(expectedChangeId))
        this.emitUpdate()
    }
    if (!attempt) return

    // Also when it failed, as it may still land, so a reopened popup starts on a blank form
    if (seedId === this.#getSelectedSeedId() && this.#sendForm.clear()) this.emitUpdate()

    // Not the selected account: the user may have switched while the receipt was awaited. Picks
    // up the spent note and its change note.
    await this.#watchChange({ seedId, chainId, baseline, hasDeposit: false, expectedChangeId })

    // Even with no screen showing it, so the activity lists the transfer once opened. A later sync
    // of the watch marks it as not current, so opening the activity reads it again.
    await this.#sync.readHistoryWithoutSync(chainId, seedId)
  }

  /**
   * The selected account's deposits of a token that are still being verified, each with the
   * account it was made from - the only one that can take it back. From the last sync, so nothing
   * about them is asked of the network.
   */
  async getRagequitDeposits(
    chainId: string,
    tokenAddress: string
  ): Promise<PrivacyPoolsRagequitDeposit[]> {
    const seedId = this.#assertAvailableAndGetSeedId()

    return this.#ragequit.getDeposits({ seedId, chainId, tokenAddress })
  }

  /** `getRagequitDeposits` for `dispatchAndWait`, as only the Rage quit sheet needs them. */
  async getRagequitDepositsAndSendResToUi(
    chainId: string,
    tokenAddress: string,
    requestId: string
  ) {
    try {
      const deposits = await this.getRagequitDeposits(chainId, tokenAddress)

      this.#ui.message.sendUiMessage({ requestId, ok: true, res: deposits })
    } catch (error: any) {
      const emittableError =
        error instanceof EmittableError
          ? error
          : privacyPoolsErrors.ragequitDepositsReadFailed(error)

      this.#ui.message.sendUiMessage({ requestId, ok: false, error: emittableError.message })
      this.emitError(emittableError)
    }
  }

  /**
   * The account one of the selected account's deposits still being verified was made from. From
   * the last sync, so it is known before the reclaim is proved. Undefined for any other deposit.
   */
  getRagequitDepositorAddr({ chainId, label }: { chainId: string; label: bigint }) {
    const seedId = this.#assertAvailableAndGetSeedId()

    return this.#ragequit.getDepositorAddr({ seedId, chainId, label })
  }

  /**
   * Proves taking back one of the selected account's deposits still being verified, as a call of
   * the account that made it. For `MainController.privacyPoolsRagequit`, which selects that
   * account and adds the call for the user to sign. Throws an `EmittableError` otherwise.
   */
  async buildRagequitCalls({
    chainId,
    label
  }: {
    chainId: string
    label: bigint
  }): Promise<{ accountAddr: string; calls: Call[] }> {
    const seedId = this.#assertAvailableAndGetSeedId()

    return this.#ragequit.buildCalls({ seedId, chainId, label })
  }

  /** Adds a stored phrase's Privacy Pools account. Nothing is derived or synced until opened. */
  async addAccount(seedId: string): Promise<void> {
    await this.initialLoadPromise

    if (!this.#keystore.seeds.some((seed) => seed.id === seedId))
      throw privacyPoolsErrors.seedRemoved(seedId)

    if (this.#hasAccount(seedId)) throw privacyPoolsErrors.accountExists(seedId)

    this.accounts = [...this.accounts, { seedId, createdAt: Date.now() }]
    this.emitUpdate()
    await this.#persistAccounts()
  }

  /** Removes the account, not its funds: re-adding it finds them. */
  async removeAccount(seedId: string): Promise<void> {
    await this.initialLoadPromise

    this.#forgetAccount(seedId)
    this.emitUpdate()
    await this.#persistAccounts()
    await this.#onAccountsRemoved([seedId])
  }

  /** Drops an account and everything derived for it. */
  #forgetAccount(seedId: string) {
    this.accounts = this.accounts.filter((account) => account.seedId !== seedId)
    this.#phraseScopedModules.forEach((phraseScopedModule) => phraseScopedModule.forgetSeed(seedId))
  }

  /** Removes accounts whose phrase is gone - nothing in them is reachable. */
  async #forgetAccountsOfDeletedSeeds() {
    if (!this.#keystore.areSeedsLoaded) return

    const storedSeedIds = new Set(this.#keystore.seeds.map((seed) => seed.id))
    const orphanedSeedIds = this.accounts
      .map((account) => account.seedId)
      .filter((seedId) => !storedSeedIds.has(seedId))

    if (!orphanedSeedIds.length) return

    orphanedSeedIds.forEach((seedId) => this.#forgetAccount(seedId))
    this.emitUpdate()

    await this.#persistAccounts()
    await this.#onAccountsRemoved(orphanedSeedIds)
  }

  async #persistAccounts() {
    try {
      await this.#storage.set(PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY, this.accounts)
    } catch (error: any) {
      this.emitError({
        message: 'Could not save your Privacy Pools accounts on this device.',
        level: 'major',
        error: error instanceof Error ? error : new Error('privacyPools: accounts write failed')
      })
    }
  }

  #hasPhraseDerivedState() {
    return this.#phraseScopedModules.some((phraseScopedModule) =>
      phraseScopedModule.hasPhraseDerivedState()
    )
  }

  /**
   * On lock, drops everything derived from any phrase; what is known of each chain's shared state
   * stays (see `PrivacyPoolsSync.clear`). A running sync cannot be stopped, so it finishes and
   * `#lock` makes it discard its results. A withdrawal being proved is cancelled.
   */
  #teardown() {
    this.#lock.bump()
    this.#phraseScopedModules.forEach((phraseScopedModule) => phraseScopedModule.clear())
    this.emitUpdate()
  }

  destroy() {
    this.#unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.#unsubscribers = []
    this.#ui.uiEvent.off('addView', this.#onAddView)
    this.#ui.uiEvent.off('updateView', this.#onUpdateView)
    this.#ui.uiEvent.off('removeView', this.#onRemoveView)
    this.#teardown()
    super.destroy()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      supportedChainIds: this.supportedChainIds,
      unavailableReason: this.unavailableReason,
      isAvailableForSelectedAccount: this.isAvailableForSelectedAccount,
      chains: this.chains,
      balances: this.balances,
      hasSyncedAnyChain: this.hasSyncedAnyChain,
      operation: this.operation,
      depositAssetConfigs: this.depositAssetConfigs,
      history: this.history,
      sendForm: this.sendForm,
      sendFormResetCounter: this.sendFormResetCounter,
      hasPersistedSendForm: this.hasPersistedSendForm
    }
  }
}
