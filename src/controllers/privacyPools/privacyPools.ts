import EmittableError from '../../classes/EmittableError'
import { CONFIRMED_BLOCK_WAIT_TIMEOUT_MS } from '../../consts/activity'
import {
  getPrivacyPoolsAsset,
  getPrivacyPoolsChainConfig,
  getPrivacyPoolsTokenId,
  isPrivacyPoolsNativeAsset,
  PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY,
  PRIVACY_POOLS_DEPOSIT_CHIPS,
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
  PrivacyPoolsDepositPrivacy,
  PrivacyPoolsHistoryFilters,
  PrivacyPoolsHistorySession,
  PrivacyPoolsOperation,
  PrivacyPoolsRagequitDeposit,
  PrivacyPoolsSendForm,
  PrivacyPoolsTokenBalance,
  PrivacyPoolsUnavailableReason,
  PrivacyPoolsWithdrawalPrivacyCheck,
  PrivacyPoolsWithdrawalPrivacyParams
} from '../../interfaces/privacyPools'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import { ITokenPricesController } from '../../interfaces/tokenPrices'
import { IUiController, View } from '../../interfaces/ui'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus, Call } from '../../libs/accountOp/types'
import { createKohakuStorage } from '../../libs/kohaku/host'
import {
  checkKohakuFingerprints,
  getUncheckedDepositors
} from '../../libs/privacyPools/kohakuFingerprints'
import { getPrivacyPoolsDepositPrivacy } from '../../libs/privacyPools/leaks/leaks'
import { fetchPrivacyPoolsPrices, getPrivacyPoolsPriceKey } from '../../libs/privacyPools/prices'
import {
  createProverFactory,
  PrivacyPoolsProverFactory,
  withCancellableProving
} from '../../libs/privacyPools/prover'
import { readPrivacyPoolsRagequit } from '../../libs/privacyPools/ragequit'
import { Pagination } from '../../utils/paginate'
import { waitForBlockNumber } from '../../utils/waitForBlockNumber'
import EventEmitter from '../eventEmitter/eventEmitter'
import { PrivacyPoolsBuiltCalls } from './builtCalls'
import {
  getChainProvider,
  LockGeneration,
  PendingAccountOp,
  PhraseScopedModule,
  PrivacyPoolsContext
} from './context'
import { PrivacyPoolsDepositParams, PrivacyPoolsDeposits } from './deposits'
import { privacyPoolsErrors } from './errors'
import { PrivacyPoolsExpectedChanges } from './expectedChanges'
import { PrivacyPoolsHistory } from './history'
import { PrivacyPoolsPoolCoversByToken, PrivacyPoolsPoolStatsReader } from './poolStats'
import { PrivacyPoolsProtocolRegistry } from './protocolRegistry'
import { PrivacyPoolsRagequit } from './ragequit'
import { PrivacyPoolsSendFormState } from './sendForm'
import { PrivacyPoolsSync } from './sync'
import {
  PrivacyPoolsBroadcastAttempt,
  PrivacyPoolsWithdrawal,
  PrivacyPoolsWithdrawalParams
} from './withdrawal'

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

  #tokenPrices: ITokenPricesController

  /** Lets the selection move off a removed account. Also fired when a phrase is deleted. */
  #onAccountsRemoved: (seedIds: string[]) => Promise<void>

  #lock = new LockGeneration()

  #registry: PrivacyPoolsProtocolRegistry

  #sync: PrivacyPoolsSync

  #deposits: PrivacyPoolsDeposits

  #withdrawal: PrivacyPoolsWithdrawal

  #ragequit: PrivacyPoolsRagequit

  #builtCalls: PrivacyPoolsBuiltCalls

  #expectedChanges: PrivacyPoolsExpectedChanges

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

  /**
   * Per chain, its pools' numbers for a token's details, so they are there when it opens. The same
   * for every account, so they outlive a lock. Computed from this device's copy of the history
   * after each sync of it, before the balances it reads show - see `PrivacyPoolsPoolStatsReader`.
   * Not on load: a stored history is read only when the user opens a Privacy Pools account, or a
   * deposit into one.
   */
  poolStats: { [chainId: string]: PrivacyPoolsChainPoolStats } = {}

  /**
   * Per chain, whether its last check of which depositors have a Kohaku client fingerprint failed.
   * Before any check of the chain succeeds, a send that needs one stays `unchecked` until
   * `readPrivacyData` checks again.
   */
  #hasFailedFingerprintCheck: { [chainId: string]: boolean } = {}

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
    eventEmitterRegistry,
    tokenPrices
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
    /** Where the prices come from; shared with the portfolio so they share one cache */
    tokenPrices: ITokenPricesController
  }) {
    super(eventEmitterRegistry)
    this.#keystore = keystore
    this.#featureFlags = featureFlags
    this.#networks = networks
    this.#providers = providers
    this.#selectedAccount = selectedAccount
    this.#storage = storage
    this.#ui = ui
    this.#tokenPrices = tokenPrices
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
    this.#expectedChanges = new PrivacyPoolsExpectedChanges(this.#sync)
    this.#deposits = new PrivacyPoolsDeposits(
      ctx,
      this.#registry,
      this.#sync,
      this.#builtCalls,
      this.#expectedChanges
    )
    this.#poolStatsReader = new PrivacyPoolsPoolStatsReader(ctx)
    this.#withdrawal = new PrivacyPoolsWithdrawal(
      ctx,
      this.#registry,
      this.#sync,
      this.#poolStatsReader
    )
    this.#ragequit = new PrivacyPoolsRagequit(ctx, this.#registry, this.#sync, this.#builtCalls)
    this.#sendForm = new PrivacyPoolsSendFormState(ui)
    this.#history = new PrivacyPoolsHistory(ctx, this.#sync, {
      getSupportedChainIds: () => this.supportedChainIds,
      syncChain: (chainId) => this.syncChain(chainId)
    })
    this.#phraseScopedModules = [
      this.#withdrawal,
      this.#expectedChanges,
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
      const pools = await this.#poolStatsReader.read(chainId)
      // Before the chain's first sync there is nothing to show yet, not an error
      if (!pools || !isLatest()) return

      this.poolStats = {
        ...this.poolStats,
        [chainId]: { byToken: pools.statsByToken, error: null }
      }
      this.#poolStatsReader.setPoolCovers(chainId, pools.poolCovers)
      // Not awaited, so the pool's numbers never wait for it
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.#checkFingerprints(chainId, pools.poolCovers)
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
   * Checks which new depositors of a chain have a Kohaku client fingerprint, then checks the Send
   * form's transfer again. Asks about the depositors of all the chain's pools in one go, so the RPC never learns
   * which pool the user looks at. The result of a slow check is still kept, as it only adds
   * answers for new depositors. Never rejects.
   */
  async #checkFingerprints(
    chainId: string,
    poolCovers: PrivacyPoolsPoolCoversByToken
  ): Promise<void> {
    let hasFailed = false
    try {
      const uncheckedDepositors = getUncheckedDepositors(
        Object.values(poolCovers).flatMap(({ deposits }) => deposits),
        this.#poolStatsReader.getFingerprints(chainId)
      )
      let checked = new Map<string, boolean>()
      if (uncheckedDepositors.length) {
        const network = this.#networks.networks.find((n) => n.chainId.toString() === chainId)
        if (!network) throw new Error(`privacyPools: no network for chain ${chainId}`)

        checked = await checkKohakuFingerprints({
          provider: getChainProvider(this.#providers, chainId),
          supportsStateOverride: !network.rpcNoStateOverride,
          addresses: uncheckedDepositors
        })
      }
      // Added even when empty, so a chain with no depositors to check counts as checked
      this.#poolStatsReader.addFingerprints(chainId, checked)
    } catch (error: unknown) {
      // The depositors not checked add no cover until a later check, see `getSendPoolCover`
      hasFailed = true
      this.emitError(privacyPoolsErrors.fingerprintCheckFailed(error))
    }

    this.#hasFailedFingerprintCheck = { ...this.#hasFailedFingerprintCheck, [chainId]: hasFailed }
    this.#withdrawal.recheckWithdrawalPrivacy()
    this.emitUpdate()
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
        this.#withdrawal.dropPrivacyCheck()
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
    const seedId = this.#getSelectedSeedId()
    // Before 'locked', which unlocking would not fix while these hold
    if (!seedId) return 'no-account'
    if (!this.supportedChainIds.length) return 'unsupported-network'
    if (!this.#keystore.isUnlocked) return 'locked'
    if (!this.#keystore.isPrivacyKeyAvailable(seedId, 'privacyPools')) return 'passphrase-needed'

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
   * Per chain, whether the last read of the pools' deposits or the last check of which depositors
   * have a Kohaku client fingerprint failed. `readPrivacyData` tries both again.
   */
  get hasPrivacyDataFailed(): { [chainId: string]: boolean } {
    const chainIds = new Set([
      ...Object.keys(this.poolStats),
      ...Object.keys(this.#hasFailedFingerprintCheck)
    ])

    return Object.fromEntries(
      [...chainIds].map((chainId) => [chainId, this.#hasPrivacyDataFailed(chainId)])
    )
  }

  #hasPrivacyDataFailed(chainId: string): boolean {
    return !!this.poolStats[chainId]?.error || !!this.#hasFailedFingerprintCheck[chainId]
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

        const changeAmounts = seedId ? this.#expectedChanges.getChangeAmounts(seedId, chainId) : {}
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

  /** Entrypoint deposit requirements per `${chainId}:${tokenAddress}` (lowercase), read once per Send session. */
  get depositAssetConfigs(): { [key: string]: PrivacyPoolsDepositAssetConfig } {
    return this.#deposits.assetConfigs
  }

  /**
   * The privacy of the transfer the Send form last asked about - see `checkWithdrawalPrivacy`.
   * Dropped with the form.
   */
  get withdrawalPrivacy(): PrivacyPoolsWithdrawalPrivacyCheck | null {
    return this.#withdrawal.getWithdrawalPrivacyCheck(this.#getSelectedSeedId())
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

    if (reason === 'passphrase-needed') throw privacyPoolsErrors.passphraseNeeded()

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

  /**
   * Reads the prices from the price controller, which answers from its cache when they are
   * fresh, joins a request already in flight, and answers with none while the user has opted
   * out of token prices.
   */
  async #refreshPrices() {
    try {
      this.prices = await fetchPrivacyPoolsPrices({
        tokenPrices: this.#tokenPrices,
        networks: this.#networks.networks.filter(({ chainId }) =>
          this.supportedChainIds.includes(chainId.toString())
        )
      })
      this.emitUpdate()
    } catch (error: any) {
      // Previous prices, if any, stay
      this.emitError({
        level: 'silent',
        message: 'Could not load the prices of what is in Privacy Pools.',
        error: error instanceof Error ? error : new Error('privacyPools: prices request failed')
      })
    }
  }

  #dropPrices() {
    this.prices = {}
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
   * Syncs every network of the selected account. Called with each portfolio update of
   * `ContinuousUpdatesController`. Never rejects. A failure shows in the network's state.
   */
  async syncInBackground(): Promise<void> {
    await this.#syncSelectedAccountChains()
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

  /** Whether the account can sync on this network now. */
  #canSync(seedId: string, chainId: string) {
    return (
      this.#keystore.isUnlocked &&
      this.#hasAccount(seedId) &&
      this.#isSeedBackedUp(seedId) &&
      this.supportedChainIds.includes(chainId)
    )
  }

  /**
   * Syncs the account on this network once, after a change. With `blockNumber`, it first waits for
   * our RPC to reach that block. It waits for a running sync to end first, as that sync may have
   * started before the block. Never rejects.
   */
  async #syncOnce(seedId: string, chainId: string, blockNumber?: number): Promise<void> {
    try {
      if (blockNumber !== undefined) {
        const provider = getChainProvider(this.#providers, chainId)
        await waitForBlockNumber(provider, blockNumber, CONFIRMED_BLOCK_WAIT_TIMEOUT_MS)
      }
      if (!this.#canSync(seedId, chainId)) return

      await this.#sync.getRunningSync(seedId, chainId)
      await this.#sync.queue(chainId, seedId)
    } catch (error: any) {
      this.emitError({
        level: 'silent',
        message: 'Could not update your Privacy Pools balance.',
        error:
          error instanceof Error ? error : new Error('privacyPools: sync after a change failed')
      })
    }
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

    if (!this.#keystore.isPrivacyKeyAvailable(seedId, 'privacyPools'))
      throw privacyPoolsErrors.passphraseNeeded()

    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config || !this.supportedChainIds.includes(chainId))
      throw privacyPoolsErrors.depositUnsupportedNetwork(chainId)

    return this.#deposits.buildCalls(params)
  }

  /**
   * Reads the entrypoint's deposit requirements for an asset into `depositAssetConfigs`, once per
   * Send session. The deposits built after use this read. See `PrivacyPoolsDeposits.loadAssetConfig`.
   */
  loadDepositAssetConfig(
    chainId: string,
    tokenAddress: string,
    sessionId: string | null
  ): Promise<PrivacyPoolsDepositAssetConfig> {
    this.readPrivacyData(chainId)

    return this.#deposits.loadAssetConfig(chainId, tokenAddress, sessionId)
  }

  /**
   * Reads the pool's deposits the privacy checks need, which a sync may not have read yet. Does
   * nothing when they are read already, and reads again after a failure, so it also retries.
   */
  readPrivacyData(chainId: string) {
    const isRead =
      this.#poolStatsReader.hasPoolCovers(chainId) && !this.#hasPrivacyDataFailed(chainId)
    if (isRead) return

    // Shown as being checked again right away, not only once the check ends
    this.#hasFailedFingerprintCheck = {
      ...this.#hasFailedFingerprintCheck,
      [chainId]: false
    }
    this.emitUpdate()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#refreshPoolStats(chainId).then(() => this.emitUpdate())
  }

  /**
   * The privacy of a deposit that puts `amount` into a pool, of at most `maxAmount`, both after the
   * vetting fee. For `TransferController`. Rated `unchecked` before the deposits it hides among are
   * read - see `readPrivacyData`.
   */
  getDepositPrivacy({
    chainId,
    tokenAddress,
    amount,
    maxAmount
  }: {
    chainId: string
    tokenAddress: string
    amount: bigint
    maxAmount: bigint
  }): PrivacyPoolsDepositPrivacy {
    const privacy = getPrivacyPoolsDepositPrivacy({
      amount,
      maxAmount,
      poolCover: this.#poolStatsReader.getPoolCover(chainId, tokenAddress),
      commonAmounts:
        PRIVACY_POOLS_DEPOSIT_CHIPS[getPrivacyPoolsTokenId(chainId, tokenAddress)] ?? []
    })

    // A chain with no history on this device stays so until the deposit's own sync reads it
    const isLoading =
      !this.#poolStatsReader.hasPoolCovers(chainId) && !this.poolStats[chainId]?.error

    return { ...privacy, isLoading }
  }

  /**
   * Adds the expected change of each deposit or ragequit this wallet built, once its transaction is
   * sent, so the balance shows it right away. Other calls are ignored.
   */
  onAccountOpBroadcast({ chainId, calls }: { chainId: bigint; calls: Call[] }) {
    let hasAdded = false

    calls.forEach((call) =>
      this.#builtCalls.markBroadcast(
        chainId,
        call,
        ({ seedId, chainId: builtChainId, kind, tokenAddress, amount }) => {
          const changeId = this.#expectedChanges.add({
            seedId,
            chainId: builtChainId,
            kind,
            tokenAddress,
            amount,
            label: kind === 'ragequit' ? readPrivacyPoolsRagequit(call.data)?.label : undefined
          })
          if (changeId !== null) hasAdded = true

          return changeId
        }
      )
    )

    if (hasAdded) this.emitUpdate()
  }

  /**
   * Called by `MainController` with finished transactions. A deposit or ragequit that landed syncs
   * its account once, then its expected change is deleted. One that failed deletes it at once.
   * Never rejects.
   */
  async onAccountOpsFinalized(ops: SubmittedAccountOp[]): Promise<void> {
    const landed = new Map<string, { seedId: string; chainId: string; changeIds: number[] }>()
    let hasDeleted = false

    ops.forEach(({ chainId, status, calls }) => {
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

        const changeId = builtCall.broadcast?.changeId ?? null
        if (!hasLanded) {
          if (changeId !== null && this.#expectedChanges.delete(changeId)) hasDeleted = true

          return
        }

        const key = `${builtCall.seedId}:${builtCall.chainId}`
        const group = landed.get(key) || {
          seedId: builtCall.seedId,
          chainId: builtCall.chainId,
          changeIds: []
        }
        if (changeId !== null) group.changeIds.push(changeId)
        landed.set(key, group)
      })
    })

    await Promise.all(
      [...landed.values()].map(async ({ seedId, chainId, changeIds }) => {
        await this.#syncOnce(seedId, chainId)

        changeIds.forEach((changeId) => {
          if (this.#expectedChanges.delete(changeId)) hasDeleted = true
        })
      })
    )

    if (hasDeleted) this.emitUpdate()
  }

  /**
   * Checks what the Send form's transfer gives away, from the selected account's notes and this
   * device's copy of the pool. The result arrives in `withdrawalPrivacy`, in place of the previous
   * check's.
   */
  checkWithdrawalPrivacy(params: Omit<PrivacyPoolsWithdrawalPrivacyParams, 'seedId'>) {
    try {
      const seedId = this.#assertAvailableAndGetSeedId()

      this.#withdrawal.checkWithdrawalPrivacy({ ...params, seedId })
      this.emitUpdate()
    } catch (error: any) {
      this.emitError(
        error instanceof EmittableError
          ? error
          : {
              level: 'silent',
              message: 'Could not check the privacy of this transfer.',
              error: error instanceof Error ? error : new Error('privacyPools: leak check failed')
            }
      )
    }
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
    const hasDroppedPrivacyCheck = this.#withdrawal.dropPrivacyCheck()

    if (hasDroppedWithdrawal || hasClearedForm || hasDroppedPrivacyCheck) this.emitUpdate()
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
   * Sends the signed withdrawal to the bundler and waits for it. The balance shows the amount as
   * gone from the start. Once our RPC reaches the withdrawal's block, the account syncs once and
   * the expected change is deleted. If the block is unknown, it syncs at once.
   */
  async broadcastWithdrawal(): Promise<void> {
    // `operation`, so another phrase's cannot be sent
    const { operation } = this
    this.#withdrawal.assertReadyToSend(operation)
    this.#assertAvailableAndGetSeedId()

    const { seedId, chainId } = operation
    // The whole amount leaves the notes, its fee included - see `readPaymasterWithdrawal`
    const changeId = this.#expectedChanges.add({
      seedId,
      chainId,
      kind: 'withdrawal',
      tokenAddress: operation.tokenAddress,
      amount: -operation.amount
    })
    this.emitUpdate()

    let attempt: PrivacyPoolsBroadcastAttempt | null = null
    try {
      attempt = await this.#withdrawal.broadcast(operation)
    } finally {
      // Not handed to the bundler, so nothing is on its way out
      if (!attempt && changeId !== null && this.#expectedChanges.delete(changeId)) this.emitUpdate()
    }
    if (!attempt) return

    // Also when it failed, as it may still land, so a reopened popup starts on a blank form
    if (seedId === this.#getSelectedSeedId() && this.#sendForm.clear()) this.emitUpdate()

    // Not the selected account: the user may have switched while the receipt was awaited. Picks
    // up the spent note and its change note.
    await this.#syncOnce(seedId, chainId, attempt.blockNumber ?? undefined)
    if (changeId !== null) this.#expectedChanges.delete(changeId)
    this.emitUpdate()

    // Even with no screen showing it, so the activity lists the transfer once opened. A later sync
    // of the account marks it as not current, so opening the activity reads it again.
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

  /** The name a new account gets until the user renames it, e.g. "Private account 2". */
  get defaultAccountLabel() {
    return `Private account ${this.accounts.length + 1}`
  }

  /** Throws when the phrase is gone or has an account already. */
  async assertCanAddAccount(seedId: string): Promise<void> {
    await this.initialLoadPromise

    if (!this.#keystore.seeds.some((seed) => seed.id === seedId))
      throw privacyPoolsErrors.seedRemoved(seedId)

    if (this.#hasAccount(seedId)) throw privacyPoolsErrors.accountExists(seedId)
  }

  /** Adds a stored phrase's Privacy Pools account. Nothing is derived or synced until opened. */
  async addAccount(seedId: string, label: string): Promise<void> {
    await this.assertCanAddAccount(seedId)

    this.accounts = [...this.accounts, { seedId, createdAt: Date.now(), label }]
    this.emitUpdate()
    await this.#persistAccounts()
  }

  /**
   * Renames an account, keeping the name it has when `label` is empty. Replies to `requestId`
   * once saved, so the rename sheet stays open until then.
   */
  async updateAccountLabel(seedId: string, label: string, requestId?: string): Promise<void> {
    await this.initialLoadPromise

    const trimmedLabel = label.trim()
    if (!trimmedLabel || !this.#hasAccount(seedId)) {
      const message = "Couldn't rename the account. Please try again."
      // The rename sheet tells the user itself once it gets the reply
      this.emitError({
        level: requestId ? 'silent' : 'major',
        message,
        error: new Error('privacyPools: the account to rename is gone or the name is empty')
      })
      if (requestId) this.#ui.message.sendUiMessage({ requestId, ok: false, error: message })
      return
    }

    this.accounts = this.accounts.map((account) =>
      account.seedId === seedId ? { ...account, label: trimmedLabel } : account
    )
    this.emitUpdate()
    await this.#persistAccounts()
    if (requestId) this.#ui.message.sendUiMessage({ requestId, ok: true })
  }

  /** Moves an account to another place in the list. The wallet shows the accounts in this order. */
  async reorderAccounts({ fromIndex, toIndex }: { fromIndex: number; toIndex: number }) {
    await this.initialLoadPromise

    const movedAccount = this.accounts[fromIndex]
    if (!movedAccount || toIndex < 0 || toIndex >= this.accounts.length) {
      this.emitError({
        level: 'major',
        message: "Couldn't reorder the accounts. Please reload the page and try again.",
        error: new Error('privacyPools: the account to move or its new place is out of the list')
      })
      return
    }

    if (fromIndex === toIndex) return

    const reorderedAccounts = this.accounts.filter((_, index) => index !== fromIndex)
    reorderedAccounts.splice(toIndex, 0, movedAccount)
    this.accounts = reorderedAccounts
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
      await this.#keystore.removePrivacyKey(seedId, 'privacyPools')
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
    this.#builtCalls.forgetSeed(seedId)
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
      hasPrivacyDataFailed: this.hasPrivacyDataFailed,
      depositAssetConfigs: this.depositAssetConfigs,
      history: this.history,
      withdrawalPrivacy: this.withdrawalPrivacy,
      sendForm: this.sendForm,
      sendFormResetCounter: this.sendFormResetCounter,
      hasPersistedSendForm: this.hasPersistedSendForm
    }
  }
}
