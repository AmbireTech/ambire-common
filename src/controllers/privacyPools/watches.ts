import { PrivacyPoolsNote } from '../../interfaces/privacyPools'
import { PhraseScopedModule } from './context'
import { PrivacyPoolsSync } from './sync'

/** The longest a watch keeps syncing, waiting for the change it was started for to show. */
export const WATCH_MAX_DURATION_MS = 3 * 60 * 1000

/** What a change of the notes looks like: a new, spent or approved note changes it, a sync alone does not. */
export const getNotesFingerprint = (notes: PrivacyPoolsNote[]): string =>
  notes
    .map(({ label, amount, approval }) => `${label}:${amount}:${approval}`)
    .sort()
    .join(',')

/** An account's chain that is synced again and again until its notes differ from `baseline`. */
export type Watch = {
  seedId: string
  chainId: string
  /** The notes when the change was sent. Null when the chain had not been read yet. */
  baseline: string | null
  /** Whether a deposit is among the changes waited for. See `isWatchingDeposit`. */
  hasDeposit: boolean
  startedAt: number
}

/**
 * Watches for the result of a deposit, withdrawal or ragequit to show in an account's notes. A
 * single sync after it can miss it: our node may be a block behind the one that confirmed it, or
 * the transaction may land after the wait for it gave up. So a watch syncs again on every round,
 * until the notes change or its time is up.
 *
 * Holds a phrase and a fingerprint of its notes, so it is derived from the phrase.
 */
export class PrivacyPoolsWatches implements PhraseScopedModule {
  #sync: PrivacyPoolsSync

  /** Per `${chainId}:${seedId}`. */
  #watches = new Map<string, Watch>()

  constructor(sync: PrivacyPoolsSync) {
    this.#sync = sync
  }

  get hasWatches(): boolean {
    return !!this.#watches.size
  }

  /**
   * Whether a deposit into the account's chain is still being looked for. Until a sync shows it,
   * the next deposit would get the same precommitment. A withdrawal or ragequit does not change it.
   */
  isWatchingDeposit(seedId: string, chainId: string): boolean {
    return !!this.#watches.get(this.#getKey(seedId, chainId))?.hasDeposit
  }

  /** The notes of the account's last sync of the chain, as a fingerprint. Null before its first. */
  getFingerprint(seedId: string, chainId: string): string | null {
    const accountChain = this.#sync.getAccountChainStates(seedId)[chainId]
    if (!accountChain?.lastSyncedAt) return null

    return getNotesFingerprint(accountChain.notes)
  }

  /**
   * Starts watching, or starts over if the account's chain is watched already. Starting over keeps
   * waiting for a deposit the earlier watch was waiting for.
   */
  start({ seedId, chainId, baseline, hasDeposit }: Omit<Watch, 'startedAt'>) {
    const key = this.#getKey(seedId, chainId)

    this.#watches.set(key, {
      seedId,
      chainId,
      baseline,
      hasDeposit: hasDeposit || !!this.#watches.get(key)?.hasDeposit,
      startedAt: Date.now()
    })
  }

  /**
   * Syncs every watch that `canSync` allows, and ends those that saw their change. A watch whose
   * sync failed, or was discarded by a lock, stays for the next round. Never rejects, as syncs
   * do not.
   */
  async syncAll(canSync: (watch: Watch) => boolean): Promise<void> {
    this.#dropExpired()

    await Promise.all(
      [...this.#watches.values()].filter(canSync).map((watch) => this.#syncWatch(watch))
    )
  }

  hasPhraseDerivedState(): boolean {
    return this.hasWatches
  }

  forgetSeed(seedId: string) {
    this.#watches.forEach((watch, key) => {
      if (watch.seedId === seedId) this.#watches.delete(key)
    })
  }

  clear() {
    this.#watches.clear()
  }

  async #syncWatch(watch: Watch) {
    const { seedId, chainId, baseline } = watch
    const key = this.#getKey(seedId, chainId)

    // With no notes to compare with, any completed sync ends the watch, so one that was already
    // running, and may have read the chain before the change, must not count
    if (baseline === null) {
      await this.#sync.getRunningSync(seedId, chainId)
      if (this.#watches.get(key) !== watch) return
    }

    const epoch = this.#sync.getEpoch(chainId, seedId)

    await this.#sync.queue(chainId, seedId)

    // Ended, started over or cleared by a lock while it synced
    if (this.#watches.get(key) !== watch) return
    // The epoch moves on only when a sync completes
    if (this.#sync.getEpoch(chainId, seedId) === epoch) return

    if (baseline === null || this.getFingerprint(seedId, chainId) !== baseline)
      this.#watches.delete(key)
  }

  #dropExpired() {
    this.#watches.forEach((watch, key) => {
      if (Date.now() - watch.startedAt >= WATCH_MAX_DURATION_MS) this.#watches.delete(key)
    })
  }

  #getKey(seedId: string, chainId: string) {
    return `${chainId}:${seedId}`
  }
}
