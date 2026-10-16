import { IActivityController } from '../../interfaces/activity'
import { AccountOp, GasFeePayment } from '../../libs/accountOp/accountOp'
import { AccountOpIdentifiedBy } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { FeePaymentOption } from '../../libs/estimate/interfaces'
import { getSpeedUpGasPrices } from '../../libs/gasPrice/speedUp'
import { GasSpeeds } from '../../services/bundlers/types'

/**
 * Statuses of a pending transaction that mean it was processed and its place (nonce) is taken,
 * so a speed up of it can't go through anymore
 */
const REPLACED_TXN_PROCESSED_STATUSES = [
  AccountOpStatus.Success,
  AccountOpStatus.Failure,
  AccountOpStatus.UnknownButPastNonce
]

type ReplacedFeePayment = Pick<
  GasFeePayment,
  'paidBy' | 'inToken' | 'feeTokenChainId' | 'isGasTank'
>

/**
 * Holds what a speed up does differently from a normal transaction: the replacement keeps
 * the pending transaction's calls, nonce and fee payment, pays at least the minimum fee the
 * network accepts for a replacement, and has nothing to sign once the pending transaction
 * gets processed first.
 *
 * Passed to SignAccountOpController only when speeding up, so its absence means a normal
 * transaction. Not a controller: it has no state of its own for the UI, the data it works with
 * travels with the request in `accountOp.meta.speedUp`.
 */
export class SpeedUp {
  #activity: IActivityController

  #accountAddr: AccountOp['accountAddr']

  #chainId: AccountOp['chainId']

  #replacedFees?: NonNullable<NonNullable<AccountOp['meta']>['speedUp']>['replacedFees']

  #replacedIdentifiedBy?: AccountOpIdentifiedBy

  /** Captured when created, as the account op's own `gasFeePayment` gets replaced later */
  #replacedFeePayment: ReplacedFeePayment | null

  #unsubscribeFromActivity?: () => void

  /** Whether the account op is a speed up, so a SpeedUp should be created for it */
  static isSpeedUp(accountOp: AccountOp): boolean {
    return !!accountOp.meta?.speedUp?.enabled
  }

  constructor({ accountOp, activity }: { accountOp: AccountOp; activity: IActivityController }) {
    this.#activity = activity
    this.#accountAddr = accountOp.accountAddr
    this.#chainId = accountOp.chainId
    this.#replacedFees = accountOp.meta?.speedUp?.replacedFees
    this.#replacedIdentifiedBy = accountOp.meta?.speedUp?.replacedIdentifiedBy
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
    const replacedFeePayment = this.#replacedFeePayment
    if (!replacedFeePayment) return undefined

    return feeOptions.find(
      (option) =>
        option.paidBy === replacedFeePayment.paidBy &&
        option.token.address === replacedFeePayment.inToken &&
        (!replacedFeePayment.feeTokenChainId ||
          option.token.chainId === replacedFeePayment.feeTokenChainId) &&
        option.token.flags.onGasTank === replacedFeePayment.isGasTank
    )
  }

  /**
   * Calls `onProcessed` when the pending transaction gets processed, and right away if it
   * already was. It keeps calling it on every later activity update, so a caller that is busy
   * the first time (e.g. in the middle of signing) can act on a later call
   */
  watchReplacedTransaction(onProcessed: () => void) {
    this.#unsubscribeFromActivity?.()

    const checkReplacedTransaction = () => {
      if (this.#isReplacedTransactionProcessed()) onProcessed()
    }

    this.#unsubscribeFromActivity = this.#activity.onUpdate(
      checkReplacedTransaction,
      'sign-account-op-speed-up'
    )
    checkReplacedTransaction()
  }

  #isReplacedTransactionProcessed(): boolean {
    if (!this.#replacedIdentifiedBy) return false

    const replacedAccountOp = this.#activity.findByIdentifiedBy(
      this.#replacedIdentifiedBy,
      this.#accountAddr,
      this.#chainId
    )

    return !!replacedAccountOp && REPLACED_TXN_PROCESSED_STATUSES.includes(replacedAccountOp.status)
  }

  destroy() {
    this.#unsubscribeFromActivity?.()
    this.#unsubscribeFromActivity = undefined
  }
}
