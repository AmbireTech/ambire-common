import { PrivacyPoolsNote } from '../../interfaces/privacyPools'
import { BuiltCallKind } from './builtCalls'
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

/** A withdrawal is not a built call, as the SDK builds it, but it changes the notes the same way. */
export type ExpectedChangeKind = BuiltCallKind | 'withdrawal'

/**
 * An amount of a token on its way into or out of an account's notes, from a deposit, withdrawal or
 * ragequit that was sent and does not show in them yet. The balances add it to what the notes hold.
 */
export type ExpectedChange = {
  id: number
  seedId: string
  chainId: string
  kind: ExpectedChangeKind
  /** Lowercase, in the wallet's convention - `ZERO_ADDRESS` for native. */
  tokenAddress: string
  /** Positive for what arrives (a deposit), negative for what leaves (a withdrawal or ragequit). */
  amount: bigint
  /**
   * The token's total in the notes once this change has landed, with every change of the token
   * that was still open when this one was sent. Where the total stands tells that it landed.
   */
  targetTotal: bigint
  /**
   * When the wait for it began. Null until then: a deposit or ragequit waits for its transaction,
   * and the outcome of that, not time, ends the wait.
   */
  startedAt: number | null
}

/** What the changes still on their way do to a token. See `PrivacyPoolsWatches.getChangeAmounts`. */
export type ChangeAmounts = {
  /** Signed: positive for what arrives, negative for what leaves. */
  simulationAmount: bigint
  /** Positive. */
  withdrawingAmount: bigint
}

/**
 * Watches for the result of a deposit, withdrawal or ragequit to show in an account's notes. A
 * single sync after it can miss it: our node may be a block behind the one that confirmed it, or
 * the transaction may land after the wait for it gave up. So a watch syncs again on every round,
 * until the notes change or its time is up.
 *
 * Also keeps the changes the UI is told are on their way - see `ExpectedChange`. A watch stays
 * until the changes sent through it have shown, so two quick withdrawals are both waited for.
 *
 * Holds a phrase, a fingerprint of its notes and totals read from them, so it is derived from the
 * phrase.
 */
export class PrivacyPoolsWatches implements PhraseScopedModule {
  #sync: PrivacyPoolsSync

  /** Per `${chainId}:${seedId}`. */
  #watches = new Map<string, Watch>()

  #changes = new Map<number, ExpectedChange>()

  #nextChangeId = 1

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
   * waiting for a deposit the earlier watch was waiting for. The wait for the change it was
   * started for (see `expectChange`) begins with it.
   */
  start({
    seedId,
    chainId,
    baseline,
    hasDeposit,
    expectedChangeId
  }: Omit<Watch, 'startedAt'> & { expectedChangeId: number | null }) {
    const key = this.#getKey(seedId, chainId)
    const startedAt = Date.now()

    this.#watches.set(key, {
      seedId,
      chainId,
      baseline,
      hasDeposit: hasDeposit || !!this.#watches.get(key)?.hasDeposit,
      startedAt
    })

    const change = expectedChangeId === null ? undefined : this.#changes.get(expectedChangeId)
    if (change) change.startedAt = startedAt
  }

  /**
   * Records an amount that was just sent, so the balances count it until the notes show it. Returns
   * its id, or null when the chain has not been read yet: with no total to compare with, nothing
   * could tell that it landed, so none is recorded. The wait for it begins with `start`.
   */
  expectChange({
    seedId,
    chainId,
    kind,
    tokenAddress,
    amount
  }: Pick<ExpectedChange, 'seedId' | 'chainId' | 'kind' | 'tokenAddress' | 'amount'>):
    | number
    | null {
    const token = tokenAddress.toLowerCase()
    const total = this.#getTokenTotal(seedId, chainId, token)
    if (total === null) return null

    const openAmount = this.#getChanges(seedId, chainId, token).reduce(
      (sum, change) => sum + change.amount,
      0n
    )
    const id = this.#nextChangeId
    this.#nextChangeId += 1
    this.#changes.set(id, {
      id,
      seedId,
      chainId,
      kind,
      tokenAddress: token,
      amount,
      targetTotal: total + openAmount + amount,
      startedAt: null
    })

    return id
  }

  /** Forgets a change that will not land. Returns whether it was still there. */
  dropChange(id: number): boolean {
    return this.#changes.delete(id)
  }

  /**
   * Per token of the account's chain, how much the changes on their way will move its total, and
   * how much of that withdrawals take out of the approved part. A change the last sync already
   * reached is left out, as the notes show it, even before a watch sync drops it.
   */
  getChangeAmounts(seedId: string, chainId: string): { [tokenAddress: string]: ChangeAmounts } {
    const amounts: { [tokenAddress: string]: ChangeAmounts } = {}

    this.#getChanges(seedId, chainId).forEach((change) => {
      if (this.#hasLanded(change)) return

      const { tokenAddress, kind, amount } = change
      const tokenAmounts = amounts[tokenAddress] || { simulationAmount: 0n, withdrawingAmount: 0n }

      tokenAmounts.simulationAmount += amount
      // Only a withdrawal spends approved notes. A ragequit takes back a deposit still being verified
      if (kind === 'withdrawal') tokenAmounts.withdrawingAmount -= amount

      amounts[tokenAddress] = tokenAmounts
    })

    return amounts
  }

  /**
   * Syncs every watch that `canSync` allows, and ends those that saw their change. A watch whose
   * sync failed, or was discarded by a lock, stays for the next round. Returns whether a watch or
   * a change ended, which the UI has to be told. Never rejects, as syncs do not.
   */
  async syncAll(canSync: (watch: Watch) => boolean): Promise<boolean> {
    const hasExpired = this.#dropExpired()

    const results = await Promise.all(
      [...this.#watches.values()].filter(canSync).map((watch) => this.#syncWatch(watch))
    )

    return hasExpired || results.some(Boolean)
  }

  hasPhraseDerivedState(): boolean {
    return this.hasWatches || !!this.#changes.size
  }

  forgetSeed(seedId: string) {
    this.#watches.forEach((watch, key) => {
      if (watch.seedId === seedId) this.#watches.delete(key)
    })
    this.#changes.forEach((change, id) => {
      if (change.seedId === seedId) this.#changes.delete(id)
    })
  }

  clear() {
    this.#watches.clear()
    this.#changes.clear()
  }

  /** Whether it ended the watch or a change. */
  async #syncWatch(watch: Watch): Promise<boolean> {
    const { seedId, chainId, baseline } = watch
    const key = this.#getKey(seedId, chainId)

    // With no notes to compare with, any completed sync ends the watch, so one that was already
    // running, and may have read the chain before the change, must not count
    if (baseline === null) {
      await this.#sync.getRunningSync(seedId, chainId)
      if (this.#watches.get(key) !== watch) return false
    }

    const epoch = this.#sync.getEpoch(chainId, seedId)

    await this.#sync.queue(chainId, seedId)

    // Ended, started over or cleared by a lock while it synced
    if (this.#watches.get(key) !== watch) return false
    // The epoch moves on only when a sync completes
    if (this.#sync.getEpoch(chainId, seedId) === epoch) return false

    const hasLandedChange = this.#dropLandedChanges(seedId, chainId)
    const hasNotesChanged = baseline === null || this.getFingerprint(seedId, chainId) !== baseline
    // A sync that shows a change of the notes shows the deposit too, which frees the precommitment
    if (hasNotesChanged) watch.hasDeposit = false

    // Not ended while a change is still on its way: a second one starts the watch over with a
    // newer baseline, so the first landing alone must not end it
    if (!hasNotesChanged || this.#hasStartedChange(seedId, chainId)) return hasLandedChange

    this.#watches.delete(key)

    return true
  }

  /** Drops the changes of the account's chain whose total the last sync reached. */
  #dropLandedChanges(seedId: string, chainId: string): boolean {
    let hasDropped = false

    this.#getChanges(seedId, chainId).forEach((change) => {
      if (!this.#hasLanded(change)) return

      this.#changes.delete(change.id)
      hasDropped = true
    })

    return hasDropped
  }

  /** Whether the token's total in the last sync reached the change's target. False before the first sync. */
  #hasLanded({ seedId, chainId, tokenAddress, amount, targetTotal }: ExpectedChange): boolean {
    const total = this.#getTokenTotal(seedId, chainId, tokenAddress)
    if (total === null) return false

    return amount < 0n ? total <= targetTotal : total >= targetTotal
  }

  /** Whether a change of the account's chain is waited for. One still awaiting its transaction has no watch to hold up. */
  #hasStartedChange(seedId: string, chainId: string): boolean {
    return this.#getChanges(seedId, chainId).some((change) => change.startedAt !== null)
  }

  #getChanges(seedId: string, chainId: string, tokenAddress?: string): ExpectedChange[] {
    return [...this.#changes.values()].filter(
      (change) =>
        change.seedId === seedId &&
        change.chainId === chainId &&
        (tokenAddress === undefined || change.tokenAddress === tokenAddress)
    )
  }

  /** The token's total in the notes of the account's last sync of the chain. Null before its first. */
  #getTokenTotal(seedId: string, chainId: string, tokenAddress: string): bigint | null {
    const accountChain = this.#sync.getAccountChainStates(seedId)[chainId]
    if (!accountChain?.lastSyncedAt) return null

    return accountChain.notes
      .filter((note) => note.tokenAddress.toLowerCase() === tokenAddress)
      .reduce((total, note) => total + note.amount, 0n)
  }

  /** Whether it dropped any. */
  #dropExpired(): boolean {
    let hasDropped = false
    const isExpired = (startedAt: number | null) =>
      startedAt !== null && Date.now() - startedAt >= WATCH_MAX_DURATION_MS

    this.#watches.forEach((watch, key) => {
      if (!isExpired(watch.startedAt)) return

      this.#watches.delete(key)
      hasDropped = true
    })
    this.#changes.forEach((change, id) => {
      if (!isExpired(change.startedAt)) return

      this.#changes.delete(id)
      hasDropped = true
    })

    return hasDropped
  }

  #getKey(seedId: string, chainId: string) {
    return `${chainId}:${seedId}`
  }
}
