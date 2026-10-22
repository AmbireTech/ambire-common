import { IActivityController } from '../../interfaces/activity';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { FeePaymentOption } from '../../libs/estimate/interfaces';
import { GasSpeeds } from '../../services/bundlers/types';
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
export declare class SpeedUp {
    #private;
    /** Whether the account op is a speed up, so a SpeedUp should be created for it */
    static isSpeedUp(accountOp: AccountOp): boolean;
    constructor({ accountOp, activity }: {
        accountOp: AccountOp;
        activity: IActivityController;
    });
    /**
     * Raises the gas prices of every speed to the minimum the network needs to accept the
     * replacement. Speeds that are already above it are kept as they are
     */
    applyMinFees(gasPrices?: GasSpeeds): GasSpeeds | undefined;
    /** The fee option the pending transaction was paid with, as the replacement must use it too */
    findReplacedFeeOption(feeOptions: FeePaymentOption[]): FeePaymentOption | undefined;
    /**
     * Whether the pending transaction was paid in a way that isn't among the fee options anymore
     * (e.g. the account that paid has no funds left). Paying any other way would send a new
     * transaction instead of replacing the pending one, so the same calls could run twice
     */
    isReplacedFeeOptionMissing(feeOptions: FeePaymentOption[]): boolean;
    /**
     * Calls `onProcessed` when the pending transaction gets processed, and right away if it
     * already was. `onProcessed` returns whether it's done with the speed up: if not (e.g. it's
     * in the middle of signing), it's called again on the next activity update, otherwise the
     * activity stops being watched
     */
    watchReplacedTransaction(onProcessed: () => boolean): void;
    /**
     * Calls the `onProcessed` of watchReplacedTransaction if the pending transaction was
     * processed. Also for when the activity may not update anymore, e.g. the transaction got
     * processed while the speed up was being signed, so nothing is left pending
     */
    checkReplacedTransaction(): void;
    destroy(): void;
}
//# sourceMappingURL=speedUp.d.ts.map