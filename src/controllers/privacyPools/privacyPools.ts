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
  PrivacyPoolsChainState,
  PrivacyPoolsDepositAssetConfig,
  PrivacyPoolsOperation,
  PrivacyPoolsSendForm,
  PrivacyPoolsTokenBalance,
  PrivacyPoolsUnavailableReason
} from '../../interfaces/privacyPools'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import { IUiController, View } from '../../interfaces/ui'
import { Call } from '../../libs/accountOp/types'
import { createKohakuStorage } from '../../libs/kohaku/host'
import { fetchPrivacyPoolsPrices, getPrivacyPoolsPriceKey } from '../../libs/privacyPools/prices'
import {
  createProverFactory,
  PrivacyPoolsProverFactory,
  withCancellableProving
} from '../../libs/privacyPools/prover'
import EventEmitter from '../eventEmitter/eventEmitter'
import { LockGeneration, PhraseScopedModule, PrivacyPoolsContext } from './context'
import { PrivacyPoolsDepositParams, PrivacyPoolsDeposits } from './deposits'
import { privacyPoolsErrors } from './errors'
import { PrivacyPoolsProtocolRegistry } from './protocolRegistry'
import { PrivacyPoolsSendFormState } from './sendForm'
import { PrivacyPoolsSync } from './sync'
import { PrivacyPoolsWithdrawal, PrivacyPoolsWithdrawalParams } from './withdrawal'

const PRICES_MAX_AGE_MS = 5 * 60 * 1000

/** A chain read more recently than this is not read again when the account is opened. */
const SYNC_MAX_AGE_MS = 10 * 60 * 1000

/**
 * Privacy Pools state: one plugin per (chain, recovery phrase) and its notes. Scoped by phrase, as note secrets are derived from it - accounts without one (hardware,
 * private key, view-only) cannot use Privacy Pools.
 *
 * The work is done by modules (plugins, sync, deposits, withdrawal, Send form) holding their own
 * state. This stays the only `EventEmitter`: it checks what is available, wires the modules
 * together and reports their state to the UI. See `PrivacyPoolsContext`.
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

  #sendForm: PrivacyPoolsSendFormState

  /** In teardown order: a withdrawal being proved is cancelled before its plugin is dropped. */
  #phraseScopedModules: PhraseScopedModule[]

  #unsubscribers: (() => void)[] = []

  /** The selected Privacy Pools account the UI last heard of. See `#subscribeToDependencies`. */
  #selectedAccountId: string | null = null

  /**
   * USD prices of the pools' assets, keyed by `getPrivacyPoolsPriceKey`. Not from the portfolio,
   * which has no selected account while a Privacy Pools account is selected.
   */
  prices: { [priceKey: string]: number } = {}

  #pricesFetchedAt = 0

  #pricesRequest: Promise<void> | null = null

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
      getTokenPrice: (chainId, tokenAddress) =>
        this.prices[getPrivacyPoolsPriceKey(chainId, tokenAddress)] ?? null,
      emitUpdate: () => this.emitUpdate(),
      emitError: (error) => this.emitError(error)
    }
    const cancellableProverFactory = withCancellableProving(
      proverFactory ?? createProverFactory(circuitsBaseUrl),
      // Read when a proof starts, by which time the withdrawal module exists
      () => this.#withdrawal.provingSignal
    )

    this.#registry = new PrivacyPoolsProtocolRegistry(ctx, cancellableProverFactory)
    this.#sync = new PrivacyPoolsSync(ctx, this.#registry)
    this.#deposits = new PrivacyPoolsDeposits(ctx, this.#registry, this.#sync)
    this.#withdrawal = new PrivacyPoolsWithdrawal(ctx, this.#registry, this.#sync)
    this.#sendForm = new PrivacyPoolsSendFormState(ui)
    this.#phraseScopedModules = [this.#withdrawal, this.#deposits, this.#sync, this.#registry]

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
   * Each subscription invalidates a plugin or changes what the getters report. Updates are passed
   * on only when they can change what this reports, as selected account and networks update often.
   */
  #subscribeToDependencies() {
    this.#selectedAccountId = this.#selectedAccount.privacyPoolsAccountId

    this.#unsubscribers.push(
      this.#keystore.onUpdate((forceEmit) => {
        // Nothing derived from the phrase, notes included, may outlive the lock
        if (!this.#keystore.isUnlocked && this.#hasPhraseDerivedState()) this.#teardown()

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#forgetAccountsOfDeletedSeeds()

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
   * association set and can only be reclaimed publicly.
   */
  get balances(): { [chainId: string]: PrivacyPoolsTokenBalance[] } {
    const accountChains = this.#getSelectedAccountStates()

    return Object.fromEntries(
      Object.keys(this.chains).map((chainId) => {
        const byToken = new Map<string, PrivacyPoolsTokenBalance>()

        ;(accountChains[chainId]?.notes || []).forEach((note) => {
          const key = note.tokenAddress.toLowerCase()
          const asset = getPrivacyPoolsAsset(BigInt(chainId), key)
          const entry = byToken.get(key) || {
            tokenAddress: key,
            // A pool added before we list it: show the raw amount rather than hide the balance
            symbol: asset?.symbol || 'Unknown token',
            decimals: asset?.decimals ?? 0,
            isNative: asset?.isNative ?? isPrivacyPoolsNativeAsset(key),
            approvedAmount: 0n,
            pendingAmount: 0n,
            totalAmount: 0n
          }

          if (note.approval === 'approved') entry.approvedAmount += note.amount
          else entry.pendingAmount += note.amount

          entry.totalAmount += note.amount
          byToken.set(key, entry)
        })

        return [chainId, [...byToken.values()]]
      })
    )
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

  /**
   * On opening the account, syncs chains older than `SYNC_MAX_AGE_MS`. Not in `withStatus`, as
   * `sync`. Skipped until the phrase, the only way to recover the account, is backed up: the
   * dashboard asks for it before the minutes-long first read.
   */
  async syncIfStale(): Promise<void> {
    try {
      const seedId = this.#assertAvailableAndGetSeedId()
      if (this.#keystore.seeds.find(({ id }) => id === seedId)?.notBackedUp) return

      const accountChains = this.#sync.getAccountChainStates(seedId)
      const staleChainIds = this.supportedChainIds.filter((chainId) => {
        const lastSyncedAt = accountChains[chainId]?.lastSyncedAt

        return !lastSyncedAt || Date.now() - lastSyncedAt >= SYNC_MAX_AGE_MS
      })

      await Promise.all(staleChainIds.map((chainId) => this.syncChain(chainId)))
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
   * Marks a broadcast account op's deposits as awaiting the chain, however it was signed. Only
   * those `buildDepositCalls` prepared are recognised, by precommitment - others are not this
   * wallet's. Nothing is persisted, as a local log would link deposits to their withdrawals.
   */
  onAccountOpBroadcast(accountOp: { chainId: bigint; calls: Call[] }) {
    this.#deposits.onAccountOpBroadcast(accountOp)
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
   * Sends the signed withdrawal to the bundler and waits for it. Syncs either way, as a userOp can
   * land after the receipt wait gives up.
   */
  async broadcastWithdrawal(): Promise<void> {
    // `operation`, so another phrase's cannot be sent
    const { operation } = this
    this.#withdrawal.assertReadyToSend(operation)
    this.#assertAvailableAndGetSeedId()

    const attempt = await this.#withdrawal.broadcast(operation)
    if (!attempt) return

    // Also when it failed, as it may still land, so a reopened popup starts on a blank form
    if (operation.seedId === this.#getSelectedSeedId() && this.#sendForm.clear()) this.emitUpdate()

    // Picks up the spent note and its change note
    await this.syncChain(operation.chainId)
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

    try {
      await this.#keystore.removePrivacyPoolsKey(seedId)
    } catch (error: any) {
      this.emitError({
        message: 'Could not fully remove the Privacy Pools account. Please try again.',
        level: 'silent',
        error:
          error instanceof Error ? error : new Error('privacyPools: removing the stored key failed')
      })
    }
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
      sendForm: this.sendForm,
      sendFormResetCounter: this.sendFormResetCounter,
      hasPersistedSendForm: this.hasPersistedSendForm
    }
  }
}
