import { getAddress, toBeHex } from 'ethers'

import type { PrivacyPoolsV1Protocol } from '@kohaku-eth/privacy-pools'

import { fromPrivacyPoolsAssetAddress, getPrivacyPoolsChainConfig } from '../../consts/privacyPools'
import { Hex } from '../../interfaces/hex'
import {
  PrivacyPoolsAccountChainState,
  PrivacyPoolsChainState,
  PrivacyPoolsNote
} from '../../interfaces/privacyPools'
import { toPrivacyPoolsHistoryEntries } from '../../libs/privacyPools/history'
import { PhraseScopedModule, PrivacyPoolsContext } from './context'
import { PrivacyPoolsProtocolRegistry } from './protocolRegistry'

/**
 * The account's notes as the plugin holds them, the fully sent ones too, with an `amount` of 0.
 * `shouldSync` false reads what the plugin's last sync left, e.g. right after a proof that synced
 * it. Throws if the plugin has no notes, so an SDK that drops them fails clearly.
 */
export const readPrivacyPoolsNotes = async (
  protocol: PrivacyPoolsV1Protocol,
  shouldSync: boolean
): Promise<PrivacyPoolsNote[]> => {
  // Optional on the plugin interface
  if (!protocol.notes) throw new Error('privacyPools: plugin does not expose notes')

  const notes = await protocol.notes([], true, { sync: shouldSync })

  return notes.map((note) => ({
    label: note.label,
    tokenAddress: fromPrivacyPoolsAssetAddress(note.assetAddress),
    amount: note.balance,
    approval: note.approved ? 'approved' : 'pending',
    depositorAddr: getAddress(toBeHex(note.depositor, 20)) as Hex,
    depositIndex: note.deposit,
    depositValue: note.value,
    withdrawCount: note.withdraw,
    blockNumber: note.blockNumber
  }))
}

/** An account's chain before its first sync. */
const IDLE_ACCOUNT_CHAIN_STATE: PrivacyPoolsAccountChainState = {
  syncStatus: 'idle',
  syncStartedAt: null,
  error: null,
  lastSyncedAt: null,
  lastSyncDuration: null,
  notes: [],
  spentNotes: [],
  history: null,
  isHistoryCurrent: false,
  historyError: null
}

/**
 * A chain's first read of its shared state on this device. Kept through a lock: none of it comes
 * from a phrase.
 */
type InitialChainSync = {
  /**
   * Settles once the shared state is on this device, and every sync of the chain waits for it, so
   * the state is read once. Absent until the chain's first sync on this run starts, and again after
   * that read fails, so the next sync reads it.
   */
  whenDone?: Promise<void>
  /** Whether this device has read the shared state - minutes the first time. Null until looked up. */
  isDone: boolean | null
  /** In ms, when the first read ran on this run. */
  durationMs: number | null
}

/** The `whenDone` of a chain's first sync on this run, with what settles it. */
const createInitialChainRead = () => {
  let resolve = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })

  return { promise, resolve, reject }
}

type InitialChainRead = ReturnType<typeof createInitialChainRead>

/**
 * Syncing: every account syncs every chain in parallel, and asking again while a sync runs joins
 * it. Only a chain's shared state - the same for every account, and minutes to read the first
 * time - is read once: the other syncs of the chain wait for that read, then read only new blocks.
 */
export class PrivacyPoolsSync implements PhraseScopedModule {
  #ctx: PrivacyPoolsContext

  #registry: PrivacyPoolsProtocolRegistry

  /** Per chain - see `InitialChainSync`. */
  #initialChainSyncs: { [chainId: string]: InitialChainSync } = {}

  /** The running sync per account and chain. Asking again while it runs joins it. */
  #syncQueue: { [seedId: string]: { [chainId: string]: Promise<void> } } = {}

  /**
   * The plugins a sync has read an account's notes with. Only these know the account's deposits,
   * so only their history can be read without syncing - see `readHistoryWithoutSync`.
   */
  #syncedProtocols = new WeakSet<PrivacyPoolsV1Protocol>()

  /** Per account and chain: its sync and its notes. Written only through `#writeAccountState`. */
  #accountStates: { [seedId: string]: { [chainId: string]: PrivacyPoolsAccountChainState } } = {}

  /** Completed syncs per account and chain. A deposit precommitment is valid until the next one. */
  #syncEpochs: { [seedId: string]: { [chainId: string]: number } } = {}

  /** Called once the plugin has persisted a chain's shared state. Must not reject. */
  #onSharedStateSynced: (chainId: string) => Promise<unknown>

  /** Whether a sync of the account also reads its history - only while the UI shows it. */
  #isHistoryWanted: (seedId: string) => boolean

  constructor(
    ctx: PrivacyPoolsContext,
    registry: PrivacyPoolsProtocolRegistry,
    onSharedStateSynced: (chainId: string) => Promise<unknown>,
    isHistoryWanted: (seedId: string) => boolean
  ) {
    this.#ctx = ctx
    this.#registry = registry
    this.#onSharedStateSynced = onSharedStateSynced
    this.#isHistoryWanted = isHistoryWanted
  }

  getAccountChainStates(seedId: string): { [chainId: string]: PrivacyPoolsAccountChainState } {
    return this.#accountStates[seedId] || {}
  }

  /** The running sync of an account's chain, if any. */
  getRunningSync(seedId: string, chainId: string): Promise<void> | null {
    return this.#syncQueue[seedId]?.[chainId] || null
  }

  getEpoch(chainId: string, seedId: string): number {
    return this.#syncEpochs[seedId]?.[chainId] || 0
  }

  /** Per chain: an account's sync of it, with what this device knows of its shared state. */
  getChainStates(
    seedId: string | null,
    supportedChainIds: string[]
  ): { [chainId: string]: PrivacyPoolsChainState } {
    const accountChains = (seedId && this.#accountStates[seedId]) || {}
    const chainIds = new Set([
      ...supportedChainIds,
      ...Object.keys(this.#initialChainSyncs),
      ...Object.keys(accountChains)
    ])

    return Object.fromEntries(
      [...chainIds].map((chainId) => {
        // Picked by name, not spread: notes and the initial sync's `whenDone` never reach the UI
        const { syncStatus, syncStartedAt, error, lastSyncedAt, lastSyncDuration } =
          accountChains[chainId] || IDLE_ACCOUNT_CHAIN_STATE
        const initialSync = this.#initialChainSyncs[chainId]

        return [
          chainId,
          {
            chainId,
            syncStatus,
            syncStartedAt,
            error,
            isInitialSyncDone: initialSync?.isDone ?? null,
            initialSyncDuration: initialSync?.durationMs ?? null,
            lastSyncedAt,
            lastSyncDuration
          }
        ]
      })
    )
  }

  /**
   * Reads a chain's notes for any account, beside the syncs of other accounts and chains, and
   * joins the running one if there is one. Which sync reads the chain's shared state is decided
   * here, with no await in between, so exactly one does.
   */
  queue(chainId: string, seedId: string): Promise<void> {
    const runningSync = this.#syncQueue[seedId]?.[chainId]
    if (runningSync) return runningSync

    const generation = this.#ctx.lock.current
    // At once, so a sync waiting for the chain's first read already reads as under way
    this.#writeAccountState(seedId, chainId, generation, {
      syncStatus: 'syncing',
      syncStartedAt: Date.now(),
      error: null
    })
    this.#ctx.emitUpdate()

    const initialSyncDone = this.#initialChainSyncs[chainId]?.whenDone || null
    const initialRead = initialSyncDone ? null : createInitialChainRead()
    if (initialRead) {
      // Reported by the sync whose read failed, while the ones waiting fail with it
      initialRead.promise.catch(() => {})
      this.#writeInitialChainSync(chainId, { whenDone: initialRead.promise })
    }

    const sync: Promise<void> = this.#runSync({
      chainId,
      seedId,
      generation,
      initialSyncDone,
      initialRead
    }).finally(() => {
      // A lock clears the queue, so what is under this key may already be a newer sync
      if (this.#syncQueue[seedId]?.[chainId] !== sync) return

      delete this.#syncQueue[seedId]![chainId]
      if (!Object.keys(this.#syncQueue[seedId]!).length) delete this.#syncQueue[seedId]
    })
    this.#syncQueue[seedId] = { ...this.#syncQueue[seedId], [chainId]: sync }

    return sync
  }

  /**
   * Reads an account's history on a chain from its current plugin, as of that plugin's last sync,
   * without syncing again - so the balances are not shown as loading. True once the history is
   * current, also when the last sync has read it. False when the current plugin has not synced the
   * account's notes (a new one knows none of its deposits), or the last sync failed. Never rejects.
   */
  async readHistoryWithoutSync(chainId: string, seedId: string): Promise<boolean> {
    const generation = this.#ctx.lock.current
    const state = this.#accountStates[seedId]?.[chainId]
    if (state?.history && state.isHistoryCurrent) return true
    if (state?.syncStatus !== 'ready') return false
    const syncEpoch = this.getEpoch(chainId, seedId)

    try {
      const protocol = await this.#registry.getProtocol(chainId, seedId)
      if (!this.#syncedProtocols.has(protocol)) return false

      await this.#readHistory({
        protocol,
        chainId,
        seedId,
        generation,
        notes: state.notes,
        syncEpoch
      })
      this.#ctx.emitUpdate()

      return true
    } catch (error: any) {
      // A sync builds the plugin again and reports why it cannot
      this.#ctx.emitError({
        message: 'Could not load your Privacy Pools activity. Please try again.',
        level: 'silent',
        error: error instanceof Error ? error : new Error('privacyPools: plugin build failed')
      })

      return false
    }
  }

  hasPhraseDerivedState(): boolean {
    return !!Object.keys(this.#syncQueue).length || !!Object.keys(this.#accountStates).length
  }

  forgetSeed(seedId: string) {
    delete this.#syncQueue[seedId]
    delete this.#accountStates[seedId]
    delete this.#syncEpochs[seedId]
  }

  /** Keeps what is known of each chain's shared state - see `InitialChainSync`. */
  clear() {
    this.#syncQueue = {}
    this.#accountStates = {}
    this.#syncEpochs = {}
  }

  /**
   * Reads a chain's notes for an account. The chain's first sync on this run gets `initialRead`
   * and settles it once the shared state is on this device; every other sync waits for that on
   * `initialSyncDone`. Never rejects.
   */
  async #runSync({
    chainId,
    seedId,
    generation,
    initialSyncDone,
    initialRead
  }: {
    chainId: string
    seedId: string
    generation: number
    initialSyncDone: Promise<void> | null
    initialRead: InitialChainRead | null
  }): Promise<void> {
    let isChainCold = false

    try {
      if (initialSyncDone) {
        // Rejects when that read failed, which fails this sync too
        await initialSyncDone
        // Locked while this waited
        if (!this.#ctx.lock.isCurrent(generation)) return
      }

      const config = getPrivacyPoolsChainConfig(BigInt(chainId))
      isChainCold = !!config && (await this.#registry.isChainCold(config))
      // Already on this device, so the chain's other syncs need not wait
      if (!isChainCold) initialRead?.resolve()

      // The chain's first read takes minutes, whichever account triggers it. An account new to an
      // already read chain only reads the new blocks.
      const startedAt = Date.now()
      this.#writeInitialChainSync(chainId, { isDone: !isChainCold })
      this.#writeAccountState(seedId, chainId, generation, { syncStartedAt: startedAt })
      this.#ctx.emitUpdate()

      const protocol = await this.#registry.getProtocol(chainId, seedId)

      // The plugin syncs before every read, costing seconds even with no new blocks, so a
      // `sync()` first would pay twice
      const allNotes = await readPrivacyPoolsNotes(protocol, true)
      const syncedNotes = allNotes.filter(({ amount }) => amount > 0n)
      this.#syncedProtocols.add(protocol)
      // The plugin has persisted the shared state by now
      initialRead?.resolve()
      // Even if locked since, as for the initial read below: the shared state is the chain's
      await this.#onSharedStateSynced(chainId)
      const syncDuration = Date.now() - startedAt

      // Even if locked since: the shared state is the chain's, not the phrase's
      if (isChainCold)
        this.#writeInitialChainSync(chainId, { isDone: true, durationMs: syncDuration })

      // Nothing derived from the phrase is written back after a lock or account removal
      const isWritten = this.#writeAccountState(seedId, chainId, generation, {
        syncStatus: 'ready',
        syncStartedAt: null,
        error: null,
        lastSyncedAt: Date.now(),
        lastSyncDuration: syncDuration,
        notes: syncedNotes,
        spentNotes: allNotes.filter(({ amount }) => amount === 0n),
        // Kept, as a stale list beats a blank one, until the history is read again
        isHistoryCurrent: false
      })
      if (!isWritten) return

      // A deposit may have landed, which moves the next one's precommitment on
      this.#syncEpochs[seedId] = {
        ...this.#syncEpochs[seedId],
        [chainId]: this.getEpoch(chainId, seedId) + 1
      }

      this.#registry.markChainSynced(chainId)

      // In the same turn of the queue and from the same plugin, so it reads the state the notes
      // were read from, without syncing again. The balances are shown meanwhile.
      if (this.#isHistoryWanted(seedId)) {
        this.#ctx.emitUpdate()
        await this.#readHistory({
          protocol,
          chainId,
          seedId,
          generation,
          notes: syncedNotes,
          syncEpoch: this.getEpoch(chainId, seedId)
        })
      }
    } catch (error: any) {
      // Still not on this device: the next sync reads it again
      if (initialRead && isChainCold) {
        this.#writeInitialChainSync(chainId, { whenDone: undefined })
        initialRead.reject(error)
      }

      if (!this.#ctx.lock.isCurrent(generation)) return

      this.#ctx.emitError({
        message: 'Could not load your Privacy Pools balance. Please try again.',
        level: 'silent',
        error: error instanceof Error ? error : new Error('privacyPools: sync failed')
      })
      this.#writeAccountState(seedId, chainId, generation, {
        syncStatus: 'idle',
        syncStartedAt: null,
        error: 'Could not load your Privacy Pools balance on this network. Please try again.'
      })
    } finally {
      // Settled on every path, as the chain's other syncs wait for it. A no-op once settled.
      initialRead?.resolve()
      this.#ctx.emitUpdate()
    }
  }

  /**
   * Reads the account's history on the chain right after its notes, from the plugin that read
   * them, as of that sync. Even if the registry has dropped it since (see `markChainSynced`): a
   * new plugin knows none of the account's deposits until it syncs. A failure keeps the notes, and
   * the history read before. Not kept once a newer sync has read the notes, which reads the
   * history itself while a screen shows it. Never rejects.
   */
  async #readHistory({
    protocol,
    chainId,
    seedId,
    generation,
    notes,
    syncEpoch
  }: {
    protocol: PrivacyPoolsV1Protocol
    chainId: string
    seedId: string
    generation: number
    notes: PrivacyPoolsNote[]
    /** The epoch of the sync that read `notes`. Unlike its time, no other sync can share it. */
    syncEpoch: number
  }): Promise<void> {
    const isNewerSynced = () => this.getEpoch(chainId, seedId) !== syncEpoch

    try {
      // Not synced again: the notes have just synced it, so the history matches them and a
      // deposit it lists is under review exactly when its note is pending
      const events = await protocol.history(undefined, { sync: false })
      if (isNewerSynced()) return

      const pendingLabels = new Set(
        notes.filter(({ approval }) => approval === 'pending').map(({ label }) => label)
      )

      this.#writeAccountState(seedId, chainId, generation, {
        history: toPrivacyPoolsHistoryEntries({ chainId, events, pendingLabels }),
        isHistoryCurrent: true,
        historyError: null
      })
    } catch (error: any) {
      if (!this.#ctx.lock.isCurrent(generation)) return

      this.#ctx.emitError({
        message: 'Could not load your Privacy Pools activity. Please try again.',
        level: 'silent',
        error: error instanceof Error ? error : new Error('privacyPools: history read failed')
      })
      if (isNewerSynced()) return

      this.#writeAccountState(seedId, chainId, generation, {
        historyError: 'Could not load your activity on this network. Please try again.'
      })
    }
  }

  #writeInitialChainSync(chainId: string, update: Partial<InitialChainSync>) {
    this.#initialChainSyncs[chainId] = {
      ...(this.#initialChainSyncs[chainId] || { isDone: null, durationMs: null }),
      ...update
    }
  }

  /**
   * The only writer of `#accountStates`. Writes nothing after a lock, or once the account is
   * removed, as nothing derived from its phrase may outlive either. Returns whether it wrote.
   */
  #writeAccountState(
    seedId: string,
    chainId: string,
    generation: number,
    update: Partial<PrivacyPoolsAccountChainState>
  ): boolean {
    if (!this.#ctx.lock.isCurrent(generation) || !this.#ctx.hasAccount(seedId)) return false

    const accountChains = this.#accountStates[seedId] || {}
    this.#accountStates[seedId] = {
      ...accountChains,
      [chainId]: { ...(accountChains[chainId] || IDLE_ACCOUNT_CHAIN_STATE), ...update }
    }

    return true
  }
}
