import { PrivacyPoolsNote } from '../../interfaces/privacyPools'
import { BuiltCallKind } from './builtCalls'
import { PhraseScopedModule } from './context'
import { PrivacyPoolsSync } from './sync'

/** Used as the highest deposit index when the account has no notes yet. */
const NO_DEPOSIT_INDEX = -1

/** The sum of the account's approved notes of a token, which are the ones a withdrawal spends. */
const getApprovedTotal = (notes: PrivacyPoolsNote[], tokenAddress: string): bigint =>
  notes
    .filter(
      (note) =>
        note.approval === 'approved' &&
        note.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    )
    .reduce((total, note) => total + note.amount, 0n)

/** A withdrawal is not a built call, as the SDK builds it, but it changes the notes the same way. */
export type ExpectedChangeKind = BuiltCallKind | 'withdrawal'

/** A snapshot of the notes when a change was sent, used to tell when the notes include it. */
export type ExpectedChangeCheck =
  /**
   * Included once a note has a higher deposit index. Withdrawals keep the index, so only a new
   * deposit does this.
   */
  | { kind: 'deposit'; maxDepositIndex: number }
  /** Included once the deposit with this label is gone from the notes. */
  | { kind: 'ragequit'; label: bigint }
  /**
   * Included once the token's approved notes add up to no more than `approvedTotal` less the
   * withdrawal's amount. `approvedTotal` is what they add up to once the withdrawals sent before
   * this one have landed. The total is used rather than single notes, as another withdrawal sent
   * before the sync may have spent a different note of the token.
   */
  | { kind: 'withdrawal'; approvedTotal: bigint }

/** A deposit, withdrawal or ragequit that was sent and is not in the account's notes yet. */
export type ExpectedChange = {
  seedId: string
  chainId: string
  /** Lowercase, in the wallet's convention - `ZERO_ADDRESS` for native. */
  tokenAddress: string
  /** Positive for what arrives (a deposit), negative for what leaves (a withdrawal or ragequit). */
  amount: bigint
  /** The deposit a withdrawal is sent from, or a ragequit takes back. */
  label?: bigint
  check: ExpectedChangeCheck
}

/** What the changes still on their way do to a token. See `getChangeAmounts`. */
export type ChangeAmounts = {
  /** Signed: positive for what arrives, negative for what leaves. */
  simulationAmount: bigint
  /** Positive. */
  withdrawingAmount: bigint
}

/**
 * Deposits, withdrawals and ragequits that were sent but are not in the notes yet. The balance
 * adds them, so it shows the new amount right away. Each one is deleted after the sync that
 * follows its transaction.
 *
 * Another sync, for example from opening the account, may read the new notes first. To avoid
 * counting the amount twice, a change is ignored as soon as the notes include it.
 *
 * A lock deletes all of them, as they are built from the notes.
 */
export class PrivacyPoolsExpectedChanges implements PhraseScopedModule {
  #sync: PrivacyPoolsSync

  #changes = new Map<number, ExpectedChange>()

  #nextId = 1

  constructor(sync: PrivacyPoolsSync) {
    this.#sync = sync
  }

  /**
   * Adds a change to the balance and returns its id. `label` is the deposit a withdrawal is sent
   * from, or a ragequit takes back. Returns null when the account has not synced on this network
   * yet, or a ragequit has no label.
   */
  add({
    seedId,
    chainId,
    kind,
    tokenAddress,
    amount,
    label
  }: Pick<ExpectedChange, 'seedId' | 'chainId' | 'tokenAddress' | 'amount'> & {
    kind: ExpectedChangeKind
    label?: bigint
  }): number | null {
    const state = this.#sync.getAccountChainStates(seedId)[chainId]
    if (!state?.lastSyncedAt) return null

    const check = this.#readCheck({
      seedId,
      chainId,
      notes: state.notes,
      kind,
      tokenAddress,
      label
    })
    if (!check) return null

    const id = this.#nextId
    this.#nextId += 1
    this.#changes.set(id, {
      seedId,
      chainId,
      tokenAddress: tokenAddress.toLowerCase(),
      amount,
      label,
      check
    })

    return id
  }

  /** Forgets a change. Returns whether it was still there. */
  delete(id: number): boolean {
    return this.#changes.delete(id)
  }

  /**
   * Per token, how much the changes on their way add or remove, and how much withdrawals take from
   * the approved part. Changes the notes already include are ignored.
   */
  getChangeAmounts(seedId: string, chainId: string): { [tokenAddress: string]: ChangeAmounts } {
    const amounts: { [tokenAddress: string]: ChangeAmounts } = {}

    this.#getUnshownChanges(seedId, chainId).forEach(({ tokenAddress, amount, check }) => {
      const tokenAmounts = amounts[tokenAddress] || { simulationAmount: 0n, withdrawingAmount: 0n }

      tokenAmounts.simulationAmount += amount
      // Only a withdrawal spends approved notes. A ragequit takes back a deposit still being verified
      if (check.kind === 'withdrawal') tokenAmounts.withdrawingAmount -= amount

      amounts[tokenAddress] = tokenAmounts
    })

    return amounts
  }

  /**
   * Per deposit label, how much the withdrawals on their way take out of it, positive. Ones the
   * notes already include are ignored.
   */
  getWithdrawingAmountsByNote(seedId: string, chainId: string): Map<bigint, bigint> {
    const amounts = new Map<bigint, bigint>()
    this.#getUnshownChanges(seedId, chainId).forEach(({ label, amount, check }) => {
      if (check.kind !== 'withdrawal' || label === undefined) return

      amounts.set(label, (amounts.get(label) ?? 0n) - amount)
    })

    return amounts
  }

  /**
   * Whether a deposit was sent that the notes do not include yet. A new deposit would reuse its
   * precommitment.
   */
  hasExpectedDeposit(seedId: string, chainId: string): boolean {
    return this.#getUnshownChanges(seedId, chainId).some(({ check }) => check.kind === 'deposit')
  }

  hasPhraseDerivedState(): boolean {
    return !!this.#changes.size
  }

  forgetSeed(seedId: string) {
    this.#changes.forEach((change, id) => {
      if (change.seedId === seedId) this.#changes.delete(id)
    })
  }

  clear() {
    this.#changes.clear()
  }

  #readCheck({
    seedId,
    chainId,
    notes,
    kind,
    tokenAddress,
    label
  }: Pick<ExpectedChange, 'seedId' | 'chainId' | 'tokenAddress'> & {
    notes: PrivacyPoolsNote[]
    kind: ExpectedChangeKind
    label?: bigint
  }): ExpectedChangeCheck | null {
    if (kind === 'deposit') {
      return {
        kind,
        maxDepositIndex: notes.reduce(
          (maxIndex, note) => Math.max(maxIndex, note.depositIndex),
          NO_DEPOSIT_INDEX
        )
      }
    }

    if (kind === 'ragequit') return label === undefined ? null : { kind, label }

    // Withdrawals sent before this one and not shown yet still hold their amount in the notes
    const earlierWithdrawn = this.#getUnshownChanges(seedId, chainId)
      .filter(
        (change) =>
          change.check.kind === 'withdrawal' && change.tokenAddress === tokenAddress.toLowerCase()
      )
      .reduce((total, change) => total + change.amount, 0n)

    return { kind, approvedTotal: getApprovedTotal(notes, tokenAddress) + earlierWithdrawn }
  }

  /** The account's changes on this network that the notes do not include yet. */
  #getUnshownChanges(seedId: string, chainId: string): ExpectedChange[] {
    const state = this.#sync.getAccountChainStates(seedId)[chainId]
    const notes = state?.lastSyncedAt ? state.notes : null

    return [...this.#changes.values()].filter(
      (change) =>
        change.seedId === seedId &&
        change.chainId === chainId &&
        !(notes && this.#isShownInNotes(change, notes))
    )
  }

  #isShownInNotes(
    { check, amount, tokenAddress }: ExpectedChange,
    notes: PrivacyPoolsNote[]
  ): boolean {
    switch (check.kind) {
      case 'deposit':
        return notes.some((note) => note.depositIndex > check.maxDepositIndex)
      case 'ragequit':
        return !notes.some((note) => note.label === check.label)
      case 'withdrawal':
        // `amount` is negative and already includes the fee
        return getApprovedTotal(notes, tokenAddress) <= check.approvedTotal + amount
      default:
        return false
    }
  }
}
