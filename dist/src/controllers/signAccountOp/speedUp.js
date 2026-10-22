"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeedUp = void 0;
const types_1 = require("../../libs/accountOp/types");
const speedUp_1 = require("../../libs/gasPrice/speedUp");
const uuid_1 = require("../../utils/uuid");
/**
 * Statuses of a pending transaction that mean it was processed and its place (nonce) is taken,
 * so a speed up of it can't go through anymore
 */
const REPLACED_TXN_PROCESSED_STATUSES = [
    types_1.AccountOpStatus.Success,
    types_1.AccountOpStatus.Failure,
    types_1.AccountOpStatus.UnknownButPastNonce
];
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
class SpeedUp {
    #activity;
    #accountAddr;
    #chainId;
    #replacedFees;
    #replacedIdentifiedBy;
    /** Captured when created, as the account op's own `gasFeePayment` gets replaced later */
    #replacedFeePayment;
    #unsubscribeFromActivity;
    /** Set by watchReplacedTransaction, see checkReplacedTransaction */
    #onReplacedTransactionProcessed;
    /** Whether the account op is a speed up, so a SpeedUp should be created for it */
    static isSpeedUp(accountOp) {
        return !!accountOp.meta?.speedUp?.enabled;
    }
    constructor({ accountOp, activity }) {
        this.#activity = activity;
        this.#accountAddr = accountOp.accountAddr;
        this.#chainId = accountOp.chainId;
        this.#replacedFees = accountOp.meta?.speedUp?.replacedFees;
        this.#replacedIdentifiedBy = accountOp.meta?.speedUp?.replacedIdentifiedBy;
        this.#replacedFeePayment = accountOp.gasFeePayment
            ? {
                paidBy: accountOp.gasFeePayment.paidBy,
                inToken: accountOp.gasFeePayment.inToken,
                feeTokenChainId: accountOp.gasFeePayment.feeTokenChainId,
                isGasTank: accountOp.gasFeePayment.isGasTank
            }
            : null;
    }
    /**
     * Raises the gas prices of every speed to the minimum the network needs to accept the
     * replacement. Speeds that are already above it are kept as they are
     */
    applyMinFees(gasPrices) {
        if (!gasPrices || !this.#replacedFees)
            return gasPrices;
        return (0, speedUp_1.getSpeedUpGasPrices)(gasPrices, this.#replacedFees);
    }
    /** The fee option the pending transaction was paid with, as the replacement must use it too */
    findReplacedFeeOption(feeOptions) {
        const replacedFeePayment = this.#replacedFeePayment;
        if (!replacedFeePayment)
            return undefined;
        return feeOptions.find((option) => option.paidBy === replacedFeePayment.paidBy &&
            option.token.address === replacedFeePayment.inToken &&
            (!replacedFeePayment.feeTokenChainId ||
                option.token.chainId === replacedFeePayment.feeTokenChainId) &&
            option.token.flags.onGasTank === replacedFeePayment.isGasTank);
    }
    /**
     * Whether the pending transaction was paid in a way that isn't among the fee options anymore
     * (e.g. the account that paid has no funds left). Paying any other way would send a new
     * transaction instead of replacing the pending one, so the same calls could run twice
     */
    isReplacedFeeOptionMissing(feeOptions) {
        return !!this.#replacedFeePayment && !this.findReplacedFeeOption(feeOptions);
    }
    /**
     * Calls `onProcessed` when the pending transaction gets processed, and right away if it
     * already was. `onProcessed` returns whether it's done with the speed up: if not (e.g. it's
     * in the middle of signing), it's called again on the next activity update, otherwise the
     * activity stops being watched
     */
    watchReplacedTransaction(onProcessed) {
        this.#stopWatchingReplacedTransaction();
        this.#onReplacedTransactionProcessed = onProcessed;
        // Unique, as unsubscribing removes every listener with the same id, which would stop
        // the other open speed ups from watching their transactions
        this.#unsubscribeFromActivity = this.#activity.onUpdate(() => this.checkReplacedTransaction(), `sign-account-op-speed-up-${(0, uuid_1.generateUuid)()}`);
        this.checkReplacedTransaction();
    }
    /**
     * Calls the `onProcessed` of watchReplacedTransaction if the pending transaction was
     * processed. Also for when the activity may not update anymore, e.g. the transaction got
     * processed while the speed up was being signed, so nothing is left pending
     */
    checkReplacedTransaction() {
        if (!this.#onReplacedTransactionProcessed || !this.#isReplacedTransactionProcessed())
            return;
        if (this.#onReplacedTransactionProcessed())
            this.#stopWatchingReplacedTransaction();
    }
    #stopWatchingReplacedTransaction() {
        this.#unsubscribeFromActivity?.();
        this.#unsubscribeFromActivity = undefined;
    }
    #isReplacedTransactionProcessed() {
        if (!this.#replacedIdentifiedBy)
            return false;
        const replacedAccountOp = this.#activity.findByIdentifiedBy(this.#replacedIdentifiedBy, this.#accountAddr, this.#chainId);
        const replacedStatus = replacedAccountOp?.status;
        return !!replacedStatus && REPLACED_TXN_PROCESSED_STATUSES.includes(replacedStatus);
    }
    destroy() {
        this.#stopWatchingReplacedTransaction();
        this.#onReplacedTransactionProcessed = undefined;
    }
}
exports.SpeedUp = SpeedUp;
//# sourceMappingURL=speedUp.js.map