import { SafeFeePayerLinks } from '../../interfaces/signAccountOp';
/**
 * Rank of an account paying a Safe's fee, lower is better: the last payer first, then the
 * owners, then the other payers already linked to the Safe, then the rest, which would get
 * publicly linked to it by paying.
 */
export declare function getSafeFeePayerRank(paidBy: string, links: SafeFeePayerLinks): number;
/**
 * Whether paying a Safe's fee from `paidBy` would publicly link a new account to the Safe.
 * The Safe paying by itself (e.g. through the gas tank) links nothing.
 */
export declare function isUnlinkedSafeFeePayer(paidBy: string, safeAddr: string, links: SafeFeePayerLinks): boolean;
//# sourceMappingURL=feePayerLinks.d.ts.map