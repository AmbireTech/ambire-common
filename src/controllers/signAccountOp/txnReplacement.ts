import { IActivityController } from '../../interfaces/activity'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { isCancelAccountOp } from '../../libs/accountOp/cancel'
import { findReplacedFeeOption, ReplacedFeePayment } from '../../libs/accountOp/replacement'
import { AccountOpIdentifiedBy } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { FeePaymentOption } from '../../libs/estimate/interfaces'
import { getSpeedUpGasPrices } from '../../libs/gasPrice/speedUp'
import { GasSpeeds } from '../../services/bundlers/types'
import isSameAddr from '../../utils/isSameAddr'
import { generateUuid } from '../../utils/uuid'

/**
 * Statuses of a pending transaction that mean it was processed and its place (nonce) is taken,
 * so a speed up of it can't go through anymore
 */
const REPLACED_TXN_PROCESSED_STATUSES = [
  AccountOpStatus.Success,
  AccountOpStatus.Failure,
  AccountOpStatus.UnknownButPastNonce
]

/**
 * How a transaction takes the place (nonce) of a pending one:
 * `speedUp` sends the same calls with a higher fee, `cancel` sends empty calls instead (see
 * `toCancelAccountOp`), and `newCalls` sends the calls of a new request instead (see
 * `SignAccountOpController.replacePendingAccountOp`).
 */
export type TxnReplacementKind = 'speedUp' | 'cancel' | 'newCalls'

/**
 * Holds what a replacement of a pending transaction does differently from a normal
 * transaction: it keeps the pending transaction's nonce and fee payment, pays at least the
 * minimum fee the network accepts for a replacement, and has nothing to replace once the
 * pending transaction gets processed first. A speed up also keeps the calls and the
 * signatures. A cancel swaps the calls for empty ones, so it has to be signed again, unless
 * it's a pending cancel being sped up, which keeps its signatures. A `newCalls` replacement
 * sends the calls of a new request and is signed like a normal transaction.
 *
 * Passed to SignAccountOpController only when replacing, so its absence means a normal
 * transaction. Not a controller: it has no state of its own for the UI, the data it works with
 * travels with the request in `accountOp.meta.speedUp`.
 */
export class TxnReplacement {
  #activity: IActivityController

  /** The account that sent the pending transaction */
  readonly accountAddr: AccountOp['accountAddr']

  #chainId: AccountOp['chainId']

  #replacedFees?: NonNullable<NonNullable<AccountOp['meta']>['speedUp']>['replacedFees']

  #replacedIdentifiedBy?: AccountOpIdentifiedBy

  /** Captured when created, as the account op's own `gasFeePayment` gets replaced later */
  #replacedFeePayment: ReplacedFeePayment | null

  /**
   * The account nonce of the pending transaction. Taken from `meta.speedUp.replacedNonce`, where
   * a cancel records it (see `toCancelAccountOp`), or captured when created, as the account op's
   * own nonce is set to the next one to simulate on the pending block (see RequestsController)
   */
  readonly replacedNonce: AccountOp['nonce']

  readonly kind: TxnReplacementKind

  /**
   * The id of the pending op that a `newCalls` replacement takes the place of, as the Activity
   * lists it (see `getReplacementAccountOp`). Undefined for a speed up or a cancel, whose request
   * gets an id of its own.
   */
  readonly replacedAccountOpId?: AccountOp['id']

  /**
   * A cancel that is signed anew: made from the pending transaction it cancels, whose
   * signatures don't apply to its empty calls (see `toCancelAccountOp`). A speed up of a
   * pending cancel isn't one, as it reuses the signatures of that cancel
   */
  readonly isNewCancel: boolean

  #unsubscribeFromActivity?: () => void

  /** Set by watchReplacedTransaction, see checkReplacedTransaction */
  #onReplacedTransactionProcessed?: () => boolean

  /** Whether the account op is a speed up, so a SpeedUp should be created for it */
  static isSpeedUp(accountOp: AccountOp): boolean {
    return !!accountOp.meta?.speedUp?.enabled
  }

  /** Whether the account op is a speed up that cancels the pending transaction */
  static isCancel(accountOp: AccountOp): boolean {
    return isCancelAccountOp(accountOp)
  }

  /**
   * @param accountOp the replacement account op (see `getReplacementAccountOp`)
   * @param withNewCalls whether a new request's calls replace the pending ones (`newCalls`)
   */
  constructor({
    accountOp,
    activity,
    withNewCalls = false
  }: {
    accountOp: AccountOp
    activity: IActivityController
    withNewCalls?: boolean
  }) {
    this.#activity = activity
    this.accountAddr = accountOp.accountAddr
    this.#chainId = accountOp.chainId
    this.#replacedFees = accountOp.meta?.speedUp?.replacedFees
    this.#replacedIdentifiedBy = accountOp.meta?.speedUp?.replacedIdentifiedBy
    this.replacedNonce = accountOp.meta?.speedUp?.replacedNonce ?? accountOp.nonce
    if (withNewCalls) {
      this.kind = 'newCalls'
      this.replacedAccountOpId = accountOp.id
    } else this.kind = TxnReplacement.isCancel(accountOp) ? 'cancel' : 'speedUp'
    this.isNewCancel = this.kind === 'cancel' && !accountOp.signature
    this.#replacedFeePayment = accountOp.gasFeePayment
      ? {
          paidBy: accountOp.gasFeePayment.paidBy,
          inToken: accountOp.gasFeePayment.inToken,
          feeTokenChainId: accountOp.gasFeePayment.feeTokenChainId,
          isGasTank: accountOp.gasFeePayment.isGasTank
        }
      : null
  }

  /**
   * Raises the gas prices of every speed to the minimum the network needs to accept the
   * replacement. Speeds that are already above it are kept as they are
   */
  applyMinFees(gasPrices?: GasSpeeds): GasSpeeds | undefined {
    if (!gasPrices || !this.#replacedFees) return gasPrices

    return getSpeedUpGasPrices(gasPrices, this.#replacedFees)
  }

  /** The fee option the pending transaction was paid with, as the replacement must use it too */
  findReplacedFeeOption(feeOptions: FeePaymentOption[]): FeePaymentOption | undefined {
    return findReplacedFeeOption(this.#replacedFeePayment, feeOptions)
  }

  /**
   * Whether `senderAddr` is the account that paid the pending transaction, whose nonce the
   * replacement takes. True when nothing was captured to compare with.
   */
  isSentBySameAccountAsReplaced(senderAddr: string): boolean {
    return !this.#replacedFeePayment || isSameAddr(this.#replacedFeePayment.paidBy, senderAddr)
  }

  /**
   * Whether the pending transaction was paid in a way that isn't among the fee options anymore
   * (e.g. the account that paid has no funds left). Paying any other way would send a new
   * transaction instead of replacing the pending one, so the same calls could run twice
   */
  isReplacedFeeOptionMissing(feeOptions: FeePaymentOption[]): boolean {
    return !!this.#replacedFeePayment && !this.findReplacedFeeOption(feeOptions)
  }

  /**
   * Calls `onProcessed` when the pending transaction gets processed, and right away if it
   * already was. `onProcessed` returns whether it's done with the speed up: if not (e.g. it's
   * in the middle of signing), it's called again on the next activity update, otherwise the
   * activity stops being watched
   */
  watchReplacedTransaction(onProcessed: () => boolean) {
    this.#stopWatchingReplacedTransaction()
    this.#onReplacedTransactionProcessed = onProcessed

    // Unique, as unsubscribing removes every listener with the same id, which would stop
    // the other open speed ups from watching their transactions
    this.#unsubscribeFromActivity = this.#activity.onUpdate(
      () => this.checkReplacedTransaction(),
      `sign-account-op-speed-up-${generateUuid()}`
    )
    this.checkReplacedTransaction()
  }

  /**
   * Calls the `onProcessed` of watchReplacedTransaction if the pending transaction was
   * processed. Also for when the activity may not update anymore, e.g. the transaction got
   * processed while the speed up was being signed, so nothing is left pending
   */
  checkReplacedTransaction() {
    if (!this.#onReplacedTransactionProcessed || !this.isReplacedTransactionProcessed()) return
    if (this.#onReplacedTransactionProcessed()) this.#stopWatchingReplacedTransaction()
  }

  #stopWatchingReplacedTransaction() {
    this.#unsubscribeFromActivity?.()
    this.#unsubscribeFromActivity = undefined
  }

  /** Whether the pending transaction was processed, so its place (nonce) is taken */
  isReplacedTransactionProcessed(): boolean {
    if (!this.#replacedIdentifiedBy) return false

    const replacedAccountOp = this.#activity.findByIdentifiedBy(
      this.#replacedIdentifiedBy,
      this.accountAddr,
      this.#chainId
    )

    const replacedStatus = replacedAccountOp?.status

    return !!replacedStatus && REPLACED_TXN_PROCESSED_STATUSES.includes(replacedStatus)
  }

  destroy() {
    this.#stopWatchingReplacedTransaction()
    this.#onReplacedTransactionProcessed = undefined
  }
}
