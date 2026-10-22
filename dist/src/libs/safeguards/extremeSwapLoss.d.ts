export declare function getSwapQuoteLossUsd(inputValueInUsd: number, outputValueInUsd: number): number;
export declare function getSwapSlippageLossUsd(inputValueInUsd: number, minInUsd: number): number;
export declare function getSwapEstimatedLossUsd(inputValueInUsd: number, outputValueInUsd: number, minInUsd: number): number;
export declare function isExtremeSwapLoss(estimatedLossUsd: number): boolean;
export declare function normalizeConfirmationPhraseInput(phrase: string): string;
/** Picks one of the confirmation phrases the user has to type to confirm an extreme-loss swap. */
export declare function getRandomExtremeSwapConfirmationPhrase(): string;
//# sourceMappingURL=extremeSwapLoss.d.ts.map