import { AddressPoisoningMatch } from '@/interfaces/transfer';
/**
 * Address poisoning lookalikes usually preserve a few consecutive chars from the left and/or
 * right side of the original address. We consider any recipient with at least 8 matched chars
 * in total as suspicious, while still keeping the exact prefix/suffix counts so downstream UI
 */
export declare const getAddressPoisoningMatchCounts: (candidate: string, trustedAddress: string) => {
    matchedPrefixCharsCount: number;
    matchedSuffixCharsCount: number;
};
export type ScoredAddressPoisoningMatch = AddressPoisoningMatch & {
    lastInteractedAt: number | null;
};
/**
 * Selects the stronger poisoning match by total overlap, then weakest side strength, then recency.
 */
export declare const pickBetterPoisoningMatch: (bestMatch: ScoredAddressPoisoningMatch | null, candidateMatch: ScoredAddressPoisoningMatch) => ScoredAddressPoisoningMatch;
//# sourceMappingURL=address-poisoning.d.ts.map