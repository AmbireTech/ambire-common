import { Interface } from 'ethers'

import {
  TORNADO_CASH_ACCOUNTS_STORAGE_KEY,
  TORNADO_CASH_INITIAL_SYNC_DONE_STORAGE_KEY,
  TORNADO_CASH_CHAIN_ID,
  TORNADO_CASH_MAX_NOTES_PER_DEPOSIT,
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
import { Call } from '../../libs/accountOp/types'
import { createKohakuKeystore, createKohakuProvider } from '../../libs/kohaku/host'
import { getPrivateAccountSeedId } from '../../libs/privateAccount/privateAccount'
import { countTornadoCashNotes, splitIntoTornadoCashNotes } from '../../libs/tornadoCash/amounts'
import {
  encodeErc20Approve,
  readErc20Approve,
  readTornadoCashDeposit
} from '../../libs/tornadoCash/deposit'
import { TORNADO_CASH_PLUGIN_STOPPED_MESSAGE } from '../../libs/tornadoCash/plugin'
import { fetchTornadoCashPrices } from '../../libs/tornadoCash/prices'
import EventEmitter from '../eventEmitter/eventEmitter'
import { TORNADO_CASH_SYNC_FAILED_MESSAGE, tornadoCashErrors } from './errors'
import { countNotesPerPool, TornadoCashWithdrawal, TornadoCashWithdrawalParams } from './withdrawal'

/** A sync older than this is redone when the account is opened. */
const STALE_SYNC_MS = 10 * 60 * 1000

/** Prices are fetched again after this long, at the next sync. */
const PRICES_MAX_AGE_MS = 10 * 60 * 1000

/** How long a broadcast deposit blocks building one that reuses its notes - see `#broadcastDeposits`. */
const DEPOSIT_CONFIRMATION_WINDOW_MS = 15 * 60 * 1000

/** USDT refuses to change a non-zero allowance to another non-zero one. */
const USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7'

const ALLOWANCE_INTERFACE = new Interface([
  'function allowance(address owner, address spender) view returns (uint256)'
])

/** A deposit from a wallet account into a Tornado Cash account. */
export type TornadoCashDepositParams = {
  /** The Tornado Cash account receiving the funds. */
  seedId: string
  /** The wallet account sending them. */
  accountAddr: string
  /** The wallet's address of the asset: the zero address for ETH. */
  assetAddress: string
  amount: bigint
}

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

  /** Commitments of deposits this controller built, so a broadcast one can be recognised. */
  #preparedCommitments = new Set<string>()

  /**
   * When each of its deposits was broadcast, by commitment. The SDK numbers a phrase's notes by
   * the deposits it has seen mined, so one built before the last is mined reuses its notes and
   * fails on chain. Not stored: it would link the sender to the account.
   */
  #broadcastDeposits = new Map<string, number>()

  #withdrawal: TornadoCashWithdrawal

  /** At most one per stored recovery phrase, and removed with it. */
  accounts: TornadoCashAccount[] = []

  /** The selected account's sync. */
  syncState: TornadoCashSyncState = IDLE_SYNC

  /**
   * Whether this device has read the pools' history - about a minute the first time. The SDK
   * keeps it for every account, so later syncs, of any account, read only new blocks. Null until
   * loaded.
   */
  isInitialSyncDone: boolean | null = null

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
    this.#withdrawal = new TornadoCashWithdrawal({
      fetch,
      getSelectedSeedId: () => this.#getSelectedSeedId(),
      getOwnedNotes: () =>
        this.#notes && countNotesPerPool(this.#notes.map(({ poolAddress }) => poolAddress)),
      withPlugin: (seedId, action) => this.#withPlugin(seedId, action),
      getGeneration: () => this.#generation,
      // The notes it spent are gone; a later sync would find it anyway
      onSent: () => {
        this.syncSelectedAccount().catch(() => {})
      },
      emitUpdate: () => this.emitUpdate()
    })

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
    this.isInitialSyncDone = await this.#storage.get(
      TORNADO_CASH_INITIAL_SYNC_DONE_STORAGE_KEY,
      false
    )
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
      // The history stays on the device even if the account changed meanwhile
      await this.#markInitialSyncDone()
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

  /**
   * Builds the calls of a deposit into a Tornado Cash account, one per note, after syncing the
   * pools (slow the first time). Everything the SDK returns is checked: only the supported pools,
   * exactly the notes `amount` splits into, and approvals only for them.
   */
  async buildDepositCalls({
    seedId,
    accountAddr,
    assetAddress,
    amount
  }: TornadoCashDepositParams): Promise<Call[]> {
    await this.initialLoadPromise

    if (!this.#hasAccount(seedId)) throw tornadoCashErrors.depositAccountRemoved()
    if (!this.#pluginFactory) throw tornadoCashErrors.unsupportedPlatform()
    if (!this.#providers.providers[CHAIN_ID]) throw tornadoCashErrors.unsupportedNetwork()
    if (!this.#keystore.isUnlocked) throw tornadoCashErrors.locked()

    const noteCounts = splitIntoTornadoCashNotes(assetAddress, amount)
    if (!noteCounts) throw tornadoCashErrors.depositAmountNotSplittable(assetAddress)
    if (countTornadoCashNotes(noteCounts) > TORNADO_CASH_MAX_NOTES_PER_DEPOSIT)
      throw tornadoCashErrors.depositTooManyNotes()

    const generation = this.#generation
    const txs = await this.#withPlugin(seedId, (plugin) =>
      plugin.prepareShield({ assetAddress, amount })
    )
    if (generation !== this.#generation) throw tornadoCashErrors.depositAccountRemoved()

    const expectedDenominations = noteCounts.flatMap(({ pool, count }) =>
      Array<bigint>(count).fill(pool.denomination)
    )
    const { calls, commitments } = this.#verifyDepositTxs(txs, assetAddress, expectedDenominations)

    const now = Date.now()
    const isReusingANote = commitments.some((commitment) => {
      const broadcastAt = this.#broadcastDeposits.get(commitment)
      return !!broadcastAt && now - broadcastAt < DEPOSIT_CONFIRMATION_WINDOW_MS
    })
    if (isReusingANote) throw tornadoCashErrors.depositPending()

    commitments.forEach((commitment) => this.#preparedCommitments.add(commitment))

    return [...(await this.#usdtAllowanceResets(calls, accountAddr)), ...calls]
  }

  #verifyDepositTxs(
    txs: { to: string; data: string; value: bigint }[],
    assetAddress: string,
    expectedDenominations: bigint[]
  ): { calls: Call[]; commitments: string[] } {
    const asset = assetAddress.toLowerCase()
    const isNative = asset === '0x0000000000000000000000000000000000000000'
    const depositedDenominations: bigint[] = []
    const commitments: string[] = []

    const calls = txs.map((tx): Call => {
      const deposit = readTornadoCashDeposit(tx)
      if (deposit) {
        const isRightAsset = deposit.pool.assetAddress.toLowerCase() === asset
        const isRightValue = tx.value === (isNative ? deposit.pool.denomination : 0n)
        if (!isRightAsset || !isRightValue) throw tornadoCashErrors.depositMisbuilt('deposit')

        depositedDenominations.push(deposit.pool.denomination)
        commitments.push(deposit.commitment)
        return { to: tx.to, data: tx.data, value: tx.value }
      }

      const approve = readErc20Approve(tx)
      const spenderPool = TORNADO_CASH_POOLS.find(({ address }) => address === approve?.spender)
      const isPoolApproval =
        !isNative &&
        !!approve &&
        tx.value === 0n &&
        approve.token === asset &&
        spenderPool?.assetAddress.toLowerCase() === asset &&
        approve.amount === spenderPool.denomination
      if (!isPoolApproval) throw tornadoCashErrors.depositMisbuilt('call')

      return { to: tx.to, data: tx.data, value: 0n }
    })

    const sortDenominations = (list: bigint[]) => [...list].sort((a, b) => (a > b ? -1 : 1))
    const isExactSplit =
      sortDenominations(depositedDenominations).join() ===
      sortDenominations(expectedDenominations).join()
    if (!isExactSplit) throw tornadoCashErrors.depositMisbuilt('notes')

    return { calls, commitments }
  }

  /** Zeroes the sender's USDT allowance to a pool first where it is not zero, as USDT requires. */
  async #usdtAllowanceResets(calls: Call[], owner: string): Promise<Call[]> {
    const spenders = [
      ...new Set(
        calls
          .map(readErc20Approve)
          .filter((approve) => approve?.token === USDT_ADDRESS)
          .map((approve) => approve!.spender)
      )
    ]
    const provider = this.#providers.providers[CHAIN_ID]
    if (!spenders.length || !provider) return []

    const resets = await Promise.all(
      spenders.map(async (spender) => {
        const result = await provider.call({
          to: USDT_ADDRESS,
          data: ALLOWANCE_INTERFACE.encodeFunctionData('allowance', [owner, spender])
        })
        const [allowance] = ALLOWANCE_INTERFACE.decodeFunctionResult('allowance', result)

        return allowance > 0n
          ? [{ to: USDT_ADDRESS, data: encodeErc20Approve(spender, 0n), value: 0n }]
          : []
      })
    )

    return resets.flat()
  }

  /** Recognises the deposits this controller built among a broadcast account op's calls. */
  onAccountOpBroadcast({ chainId, calls }: { chainId: bigint; calls: Call[] }) {
    if (chainId !== TORNADO_CASH_CHAIN_ID) return

    calls
      .map((call) => readTornadoCashDeposit({ to: call.to, data: call.data, value: call.value }))
      .filter((deposit): deposit is NonNullable<typeof deposit> => !!deposit)
      .filter(({ commitment }) => this.#preparedCommitments.has(commitment))
      .forEach(({ commitment }) => this.#broadcastDeposits.set(commitment, Date.now()))
  }

  /** The selected account's send, while one is prepared, sent or just finished. */
  get operation() {
    return this.#withdrawal.operation
  }

  /** Proves and signs a send of whole notes to `recipient`; the user confirms the fee next. */
  async prepareWithdrawal(params: TornadoCashWithdrawalParams) {
    await this.initialLoadPromise
    if (this.unavailableReason) throw this.#getUnavailableError()

    await this.#withdrawal.prepare(params)
  }

  /** Sends the prepared withdrawal. */
  async broadcastWithdrawal() {
    await this.#withdrawal.broadcast()
  }

  /** Drops a finished or unsent operation. */
  dismissOperation() {
    this.#withdrawal.dismiss()
    this.emitUpdate()
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

  async #markInitialSyncDone() {
    if (this.isInitialSyncDone) return

    this.isInitialSyncDone = true
    this.emitUpdate()
    try {
      await this.#storage.set(TORNADO_CASH_INITIAL_SYNC_DONE_STORAGE_KEY, true)
    } catch (error: any) {
      // Only the next run's first sync would be labelled as such again
      this.emitError({
        level: 'silent',
        message: 'tornadoCash: storing that the first sync is done failed',
        error:
          error instanceof Error ? error : new Error('tornadoCash: storing initial sync failed')
      })
    }
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
    this.#withdrawal.clear()
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
      balances: this.balances,
      operation: this.operation
    }
  }
}
