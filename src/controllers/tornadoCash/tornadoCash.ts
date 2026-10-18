import {
  TORNADO_CASH_ACCOUNTS_STORAGE_KEY,
  TORNADO_CASH_CHAIN_ID,
  TORNADO_CASH_POOLS
} from '../../consts/tornadoCash'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { Fetch } from '../../interfaces/fetch'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import {
  TornadoCashAccount,
  TornadoCashNote,
  TornadoCashPlugin,
  TornadoCashPluginFactory,
  TornadoCashSyncState,
  TornadoCashTokenBalance,
  TornadoCashUnavailableReason
} from '../../interfaces/tornadoCash'
import { createKohakuKeystore, createKohakuProvider } from '../../libs/kohaku/host'
import { getPrivateAccountSeedId } from '../../libs/privateAccount/privateAccount'
import { TORNADO_CASH_PLUGIN_STOPPED_MESSAGE } from '../../libs/tornadoCash/plugin'
import { fetchTornadoCashPrices } from '../../libs/tornadoCash/prices'
import EventEmitter from '../eventEmitter/eventEmitter'
import { TORNADO_CASH_SYNC_FAILED_MESSAGE, tornadoCashErrors } from './errors'

/** A sync older than this is redone when the account is opened. */
const STALE_SYNC_MS = 10 * 60 * 1000

/** Prices are fetched again after this long, at the next sync. */
const PRICES_MAX_AGE_MS = 10 * 60 * 1000

const CHAIN_ID = TORNADO_CASH_CHAIN_ID.toString()

const IDLE_SYNC: TornadoCashSyncState = {
  status: 'idle',
  startedAt: null,
  lastSyncedAt: null,
  lastSyncDuration: null,
  error: null
}

/**
 * Manages Tornado Cash accounts, at most one per recovery phrase, and the selected one's notes.
 *
 * The SDK runs outside the background (`TornadoCashPluginFactory`): one plugin at a time, for the
 * selected account, started when its dashboard asks for a sync. Notes and balances are never
 * stored, so nothing on the device links a deposit to its withdrawal; the pools' public history
 * is kept by the SDK itself.
 */
export class TornadoCashController extends EventEmitter {
  #keystore: IKeystoreController

  #featureFlags: IFeatureFlagsController

  #networks: INetworksController

  #providers: IProvidersController

  #selectedAccount: ISelectedAccountController

  #storage: IStorageController

  #fetch: Fetch

  #pluginFactory?: TornadoCashPluginFactory

  #onAccountsRemoved: (seedIds: string[]) => Promise<void>

  #unsubscribers: (() => void)[] = []

  /** The running plugin and the phrase it was started for. */
  #plugin: { seedId: string; instance: Promise<TornadoCashPlugin> } | null = null

  /**
   * Bumped whenever what a running call worked for goes away (lock, another account, removal),
   * so its results are dropped instead of shown for the wrong account.
   */
  #generation = 0

  #syncPromise: Promise<void> | null = null

  /** The selected account's unspent notes, known after its first sync. */
  #notes: TornadoCashNote[] | null = null

  #selectedSeedId: string | null = null

  #pricesFetchedAt = 0

  /** At most one per stored recovery phrase, and removed with it. */
  accounts: TornadoCashAccount[] = []

  /** The selected account's sync. */
  syncState: TornadoCashSyncState = IDLE_SYNC

  /** USD prices of the pools' assets, keyed by lowercase asset address (zero for ETH). */
  prices: { [assetAddress: string]: number } = {}

  initialLoadPromise?: Promise<void>

  constructor({
    keystore,
    featureFlags,
    networks,
    providers,
    selectedAccount,
    storage,
    fetch,
    pluginFactory,
    onAccountsRemoved,
    eventEmitterRegistry
  }: {
    keystore: IKeystoreController
    featureFlags: IFeatureFlagsController
    networks: INetworksController
    providers: IProvidersController
    selectedAccount: ISelectedAccountController
    storage: IStorageController
    fetch: Fetch
    /** Absent where the SDK cannot run (mobile, Firefox), leaving Tornado Cash unavailable. */
    pluginFactory?: TornadoCashPluginFactory
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
    this.#fetch = fetch
    this.#pluginFactory = pluginFactory
    this.#onAccountsRemoved = onAccountsRemoved

    // Cleared when done so the resolved promise isn't carried in the state sent to the UI.
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    await this.#networks.initialLoadPromise
    await this.#providers.initialLoadPromise
    await this.#keystore.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise

    this.accounts = await this.#storage.get(TORNADO_CASH_ACCOUNTS_STORAGE_KEY, [])
    // Phrases deleted while this controller was not running
    await this.#forgetAccountsOfDeletedSeeds()

    this.#selectedSeedId = this.#getSelectedSeedId()
    this.#subscribeToDependencies()
    this.emitUpdate()
  }

  #subscribeToDependencies() {
    this.#unsubscribers.push(
      this.#keystore.onUpdate((forceEmit) => {
        // Nothing derived from the phrase, notes included, may outlive the lock
        if (!this.#keystore.isUnlocked && (this.#plugin || this.#notes)) this.#teardown()

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#forgetAccountsOfDeletedSeeds()

        this.#propagateIfHasAccounts(forceEmit)
      }, 'tornadoCash'),

      // Another account's notes must never show for this one, and the plugin serves one phrase
      this.#selectedAccount.onUpdate((forceEmit) => {
        const selectedSeedId = this.#getSelectedSeedId()
        if (selectedSeedId === this.#selectedSeedId) return

        this.#selectedSeedId = selectedSeedId
        this.#teardown()
        this.propagateUpdate(forceEmit)
      }, 'tornadoCash'),

      // Only so `unavailableReason` reaches the UI
      this.#providers.onUpdate(
        (forceEmit) => this.#propagateIfHasAccounts(forceEmit),
        'tornadoCash'
      ),

      this.#featureFlags.onUpdate((forceEmit) => {
        if (!this.#featureFlags.isFeatureEnabled('tokenPrices')) {
          this.prices = {}
          this.#pricesFetchedAt = 0
        }

        this.#propagateIfHasAccounts(forceEmit)
      }, 'tornadoCash')
    )
  }

  /** Without a Tornado Cash account, nothing this controller reports depends on the others. */
  #propagateIfHasAccounts(forceEmit?: boolean) {
    if (this.accounts.length) this.propagateUpdate(forceEmit)
  }

  #getSelectedSeedId() {
    const seedId = getPrivateAccountSeedId(this.#selectedAccount.privateAccount, 'tornadoCash')

    return seedId && this.#hasAccount(seedId) ? seedId : null
  }

  #hasAccount(seedId: string) {
    return this.accounts.some((account) => account.seedId === seedId)
  }

  get unavailableReason(): TornadoCashUnavailableReason | null {
    // Before 'locked', which unlocking would not fix while these hold
    if (!this.#getSelectedSeedId()) return 'no-account'
    if (!this.#pluginFactory) return 'unsupported-platform'
    if (!this.#providers.providers[CHAIN_ID]) return 'unsupported-network'
    if (!this.#keystore.isUnlocked) return 'locked'

    return null
  }

  get isAvailableForSelectedAccount(): boolean {
    return !this.unavailableReason
  }

  /** The selected account's notes per asset, or null before its first sync. */
  get balances(): TornadoCashTokenBalance[] | null {
    if (!this.#notes) return null

    const balancesByAsset = new Map<string, TornadoCashTokenBalance>()
    this.#notes.forEach((note) => {
      const pool = TORNADO_CASH_POOLS.find(({ address }) => address === note.poolAddress)
      // A pool the wallet does not support, such as a cDAI one: nothing could withdraw it
      if (!pool) return

      const assetKey = pool.assetAddress.toLowerCase()
      const balance = balancesByAsset.get(assetKey) ?? {
        assetAddress: pool.assetAddress,
        symbol: pool.symbol,
        decimals: pool.decimals,
        amount: 0n,
        notes: []
      }
      balance.amount += pool.denomination
      const noteCount = balance.notes.find(({ denomination }) => denomination === pool.denomination)
      if (noteCount) noteCount.count += 1
      else balance.notes.push({ denomination: pool.denomination, count: 1 })

      balancesByAsset.set(assetKey, balance)
    })

    return [...balancesByAsset.values()].map((balance) => ({
      ...balance,
      notes: [...balance.notes].sort((a, b) => (a.denomination > b.denomination ? -1 : 1))
    }))
  }

  /** Syncs the selected account, unless it synced in the last minutes. For opening its dashboard. */
  async syncIfStale() {
    const { lastSyncedAt } = this.syncState
    if (lastSyncedAt && Date.now() - lastSyncedAt < STALE_SYNC_MS) return

    // As for Privacy Pools: the dashboard asks for the backup first, as the phrase is the account
    const seedId = this.#getSelectedSeedId()
    if (this.#keystore.seeds.find(({ id }) => id === seedId)?.notBackedUp) return

    await this.syncSelectedAccount()
  }

  /** Reads the pools' new events and the selected account's notes. Joins a sync already running. */
  async syncSelectedAccount() {
    await this.initialLoadPromise

    const unavailableReason = this.unavailableReason
    if (unavailableReason) {
      // The dashboard calls this on open; only an explicit refresh deserves a message
      if (unavailableReason !== 'no-account') this.emitError(this.#getUnavailableError())
      return
    }

    if (!this.#syncPromise) {
      this.#syncPromise = this.#runSync().finally(() => {
        this.#syncPromise = null
      })
    }

    await this.#syncPromise
  }

  async #runSync() {
    const seedId = this.#getSelectedSeedId()
    if (!seedId) return

    const generation = this.#generation
    const startedAt = Date.now()
    this.syncState = { ...this.syncState, status: 'syncing', startedAt, error: null }
    this.emitUpdate()

    try {
      const notes = await this.#withPlugin(seedId, async (plugin) => {
        await plugin.sync()
        return plugin.notes()
      })
      if (generation !== this.#generation) return

      this.#notes = notes
      const finishedAt = Date.now()
      this.syncState = {
        status: 'ready',
        startedAt,
        lastSyncedAt: finishedAt,
        lastSyncDuration: finishedAt - startedAt,
        error: null
      }
      this.emitUpdate()
    } catch (error: any) {
      if (generation !== this.#generation) return

      this.syncState = {
        ...this.syncState,
        status: 'ready',
        error: TORNADO_CASH_SYNC_FAILED_MESSAGE
      }
      this.emitUpdate()
      this.emitError({
        level: 'silent',
        message: TORNADO_CASH_SYNC_FAILED_MESSAGE,
        error: error instanceof Error ? error : new Error('tornadoCash: sync failed')
      })
      return
    }

    await this.#refreshPricesIfStale()
  }

  /**
   * Runs `action` on the selected account's plugin, starting one if needed. A plugin whose host
   * went away (its document closed) is replaced once, and the action retried on the new one.
   */
  async #withPlugin<T>(seedId: string, action: (plugin: TornadoCashPlugin) => Promise<T>) {
    try {
      return await action(await this.#getPlugin(seedId))
    } catch (error: any) {
      if (error?.message !== TORNADO_CASH_PLUGIN_STOPPED_MESSAGE) throw error

      this.#dropPlugin()
      return action(await this.#getPlugin(seedId))
    }
  }

  #getPlugin(seedId: string): Promise<TornadoCashPlugin> {
    if (this.#plugin?.seedId === seedId) return this.#plugin.instance
    this.#dropPlugin()

    const pluginFactory = this.#pluginFactory
    if (!pluginFactory) throw tornadoCashErrors.unsupportedPlatform()

    const provider = this.#providers.providers[CHAIN_ID]
    if (!provider) throw tornadoCashErrors.unsupportedNetwork()

    // Cached per path while this plugin lives, as each derivation decrypts the phrase
    const keystore = createKohakuKeystore((path) =>
      this.#keystore.derivePrivacyKey(seedId, 'tornadoCash', path)
    )
    const instance = pluginFactory({
      provider: createKohakuProvider(provider),
      deriveKey: (path) => keystore.deriveAt(path)
    })
    // Not kept when it fails to start, so the next call tries again
    instance.catch(() => {
      if (this.#plugin?.instance === instance) this.#plugin = null
    })
    this.#plugin = { seedId, instance }

    return instance
  }

  #dropPlugin() {
    const plugin = this.#plugin
    this.#plugin = null
    if (!plugin) return

    plugin.instance
      .then((instance) => instance.dispose())
      .catch((error) => {
        this.emitError({
          level: 'silent',
          message: 'Tornado Cash could not be stopped.',
          error: error instanceof Error ? error : new Error('tornadoCash: dispose failed')
        })
      })
  }

  async #refreshPricesIfStale() {
    if (!this.#featureFlags.isFeatureEnabled('tokenPrices')) return
    if (Date.now() - this.#pricesFetchedAt < PRICES_MAX_AGE_MS) return

    const network = this.#networks.networks.find(({ chainId }) => chainId === TORNADO_CASH_CHAIN_ID)
    if (!network) return

    try {
      this.prices = await fetchTornadoCashPrices({ fetch: this.#fetch, network })
      this.#pricesFetchedAt = Date.now()
      this.emitUpdate()
    } catch (error: any) {
      // Balances still show, only without their USD value
      this.emitError({
        level: 'silent',
        message: 'Tornado Cash prices could not be loaded.',
        error: error instanceof Error ? error : new Error('tornadoCash: prices failed')
      })
    }
  }

  #getUnavailableError() {
    switch (this.unavailableReason) {
      case 'unsupported-platform':
        return tornadoCashErrors.unsupportedPlatform()
      case 'unsupported-network':
        return tornadoCashErrors.unsupportedNetwork()
      case 'locked':
        return tornadoCashErrors.locked()
      default:
        return tornadoCashErrors.noAccountSelected()
    }
  }

  /** Adds the Tornado Cash account of a stored recovery phrase. */
  async addAccount(seedId: string): Promise<void> {
    await this.initialLoadPromise

    if (!this.#keystore.seeds.some((seed) => seed.id === seedId))
      throw tornadoCashErrors.seedRemoved(seedId)

    if (this.#hasAccount(seedId)) throw tornadoCashErrors.accountExists(seedId)

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

  #forgetAccount(seedId: string) {
    this.accounts = this.accounts.filter((account) => account.seedId !== seedId)
    if (this.#plugin?.seedId === seedId) this.#teardown()
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
      await this.#storage.set(TORNADO_CASH_ACCOUNTS_STORAGE_KEY, this.accounts)
    } catch (error: any) {
      this.emitError({
        level: 'major',
        message: 'Your Tornado Cash accounts could not be saved. Please try again.',
        error: error instanceof Error ? error : new Error('tornadoCash: storing accounts failed')
      })
    }
  }

  /**
   * Drops the plugin and everything derived from a phrase. A running call cannot be stopped, so
   * it finishes and `#generation` makes it discard its results.
   */
  #teardown() {
    this.#generation += 1
    this.#dropPlugin()
    this.#notes = null
    this.syncState = IDLE_SYNC
    this.emitUpdate()
  }

  destroy() {
    this.#unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.#unsubscribers = []
    this.#teardown()
    super.destroy()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      unavailableReason: this.unavailableReason,
      isAvailableForSelectedAccount: this.isAvailableForSelectedAccount,
      balances: this.balances
    }
  }
}
