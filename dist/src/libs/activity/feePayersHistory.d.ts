import { FeePayersHistory } from '../../controllers/activity/types';
/**
 * Record, in place, that `paidBy` paid the fee for a transaction of `accountId` on `chainId`
 * at `timestamp`, keeping the latest payment of each payer. Payments made by the account itself
 * (e.g. gas tank or its own balance) link nothing new, so they are skipped.
 * Returns whether the history changed, so callers persist only then.
 */
export declare function recordFeePayer(history: FeePayersHistory, accountId: string, chainId: bigint, paidBy: string | undefined, timestamp: number): boolean;
//# sourceMappingURL=feePayersHistory.d.ts.map