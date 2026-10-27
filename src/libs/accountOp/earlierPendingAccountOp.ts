import { PendingNonceReservation } from '../../utils/nonce'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import { collapseReplacedAccountOps, getReplacementKey } from '../activity/replacements'
import { FeePaymentOption } from '../estimate/interfaces'
import { AccountOp, getAccountOpNonce } from './accountOp'
import {
  findReplacedFeeOption,
  getReplacementAccountOp,
  getReplacementBlocker
} from './replacement'
import { SubmittedAccountOp } from './submittedAccountOp'

const isSentByRelayer = (op: Pick<AccountOp, 'gasFeePayment'>) =>
  op.gasFeePayment?.broadcastOption === BROADCAST_OPTIONS.byRelayer

/**
 * The earliest sent op that is not confirmed yet and holds a nonce the op being signed needs.
 * Null when nothing holds it back. `reservations` are the pending nonce reservations that match
 * the op's nonces (see `AccountsController.getPendingNonceReservations`), and `pendingAccountOps` the ops
 * Activity waits for, of every account.
 *
 * Sending behind a pending transaction is blocked for now. Blocks are fast and every account
 * type can batch, so the user waits or decides what to do with the pending one. Nodes also
 * refuse a second pending transaction from a delegated EOA. Ops that both go through the Relayer
 * don't hold each other back, as the Relayer orders them by nonce.
 */
export const getEarlierPendingAccountOp = ({
  accountOp,
  isSafe,
  reservations,
  pendingAccountOps
}: {
  accountOp: AccountOp
  isSafe: boolean
  reservations: PendingNonceReservation[]
  pendingAccountOps: SubmittedAccountOp[]
}): SubmittedAccountOp | null => {
  const safeNonce = isSafe ? getAccountOpNonce(accountOp) : null
  const holderIds = new Set(
    reservations
      // The Safe nonce is set when the request opens, and the user may pick the pending one on
      // purpose to replace it, so only a lower one holds the op back. A txn of the EOA that
      // executes it always does, as nodes refuse a second pending txn from a delegated EOA
      .filter(
        ({ reserved }) =>
          !isSafe ||
          reserved.kind === 'sender' ||
          (safeNonce !== null && reserved.nonce < safeNonce)
      )
      .map(({ accountOpId }) => accountOpId)
  )
  // A pending op and its speed ups replace each other, so they count as one, the newest
  const holdingOps = collapseReplacedAccountOps(
    pendingAccountOps.filter(
      (op) =>
        holderIds.has(op.id) &&
        op.id !== accountOp.id &&
        !(isSentByRelayer(accountOp) && isSentByRelayer(op))
    )
  )
  // A speed up holds the place of the op it replaces, so it's ordered by when that one was sent
  const getFirstSentAt = (op: SubmittedAccountOp) =>
    op.meta?.speedUp?.replacedSentAt ?? op.timestamp

  return holdingOps.reduce<SubmittedAccountOp | null>(
    (earliest, op) => (!earliest || getFirstSentAt(op) < getFirstSentAt(earliest) ? op : earliest),
    null
  )
}

/**
 * The account op to build a replacement from, for sending a new op in place of the earlier
 * pending op (see `getReplacementAccountOp`). Null when the new op can't replace it: the pending
 * op was sent through the Relayer or a bundler, as they hold the transaction, or the new op
 * takes more nonces than the replaced one, as only the first would be replaced and the rest
 * would still run. Not for a Safe either, where Cancel already makes a new Safe transaction at
 * that nonce. And not when the new op can't be paid the same way, as no replacement would
 * happen then.
 *
 * @param takesNoncesAfterReplaced whether the new op takes the EOA nonces after the replaced one
 * too, as one transaction per call or a delegation that signs an authorization does. They must
 * belong to the same pending op
 */
export const getEarlierPendingReplacementAccountOp = ({
  earlierPendingAccountOp,
  isSafe,
  takesNoncesAfterReplaced,
  reservations,
  pendingAccountOps,
  feeOptions
}: {
  earlierPendingAccountOp: SubmittedAccountOp
  isSafe: boolean
  takesNoncesAfterReplaced: boolean
  reservations: PendingNonceReservation[]
  pendingAccountOps: SubmittedAccountOp[]
  feeOptions: FeePaymentOption[]
}): AccountOp | null => {
  if (isSafe) return null
  if (getReplacementBlocker(earlierPendingAccountOp, true) !== null) return null
  if (earlierPendingAccountOp.identifiedBy.type === 'MultipleTxns') return null

  const replacementAccountOp = getReplacementAccountOp(earlierPendingAccountOp, 'speedUp')
  if (!replacementAccountOp) return null
  if (!findReplacedFeeOption(replacementAccountOp.gasFeePayment, feeOptions)) return null
  if (!takesNoncesAfterReplaced) return replacementAccountOp

  const replacementKey = getReplacementKey(earlierPendingAccountOp)
  const takesOnlyReplacedNonces = reservations.every(({ accountOpId }) => {
    const holder = pendingAccountOps.find((op) => op.id === accountOpId)
    return !holder || getReplacementKey(holder) === replacementKey
  })
  return takesOnlyReplacedNonces ? replacementAccountOp : null
}

/** Finds a pending op by id among the pending ops of every account. Null when it's not there. */
export const findPendingAccountOpById = (
  broadcastedButNotConfirmed: { [accountAddr: string]: SubmittedAccountOp[] } | undefined,
  accountOpId: string | null | undefined
): SubmittedAccountOp | null => {
  if (!broadcastedButNotConfirmed || !accountOpId) return null

  return (
    Object.values(broadcastedButNotConfirmed)
      .flat()
      .find((op) => op.id === accountOpId) ?? null
  )
}
