import type { GasSpeeds } from '../../services/bundlers/types';
import type { GasFeePayment } from '../accountOp/accountOp';
/** The fees of the pending transaction that is being replaced (sped up). */
type ReplacedFees = Pick<GasFeePayment, 'gasPrice' | 'maxPriorityFeePerGas'>;
/**
 * The lowest fees a transaction must pay to replace (speed up) a pending one
 * with the same nonce. Rounded up so the result never ends up just below the threshold.
 *
 * @param replacedFees - the fees of the pending transaction that is being replaced
 */
export declare function getMinReplacementFees(replacedFees: ReplacedFees): {
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
};
/**
 * Raises each speed's max fee and tip (separately) to at least the minimum needed to
 * replace (speed up) a pending transaction. Speeds that are already above it are kept as is.
 *
 * @param gasPrices - the current gas price estimation
 * @param replacedFees - the fees of the pending transaction that is being replaced
 */
export declare function getSpeedUpGasPrices(gasPrices: GasSpeeds, replacedFees: ReplacedFees): GasSpeeds;
/**
 * How much more a replacement (speed up) pays than the transaction it replaces, in whole
 * percent. Null when it isn't higher (e.g. the replacement needs less gas) or the replaced fee
 * is 0. Both amounts must be in the same token
 */
export declare function getFeeIncreasePercent(replacedAmount: bigint, newAmount: bigint): number | null;
export {};
//# sourceMappingURL=speedUp.d.ts.map