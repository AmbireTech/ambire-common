declare const panicErrorCodeToReason: (errorCode: bigint) => string | undefined;
declare const isReasonValid: (reason: string | null) => boolean;
/**
 * Counts the number of valid Unicode numbers and letters in a string.
 */
declare const countUnicodeLettersAndNumbers: (str: string) => number;
/**
 * Some reasons are encoded in hex, this function will decode them to a human-readable string
 * which can then be matched to a specific error message.
 */
declare const formatReason: (reason: string) => string;
declare const getErrorCodeStringFromReason: (reason?: string, withSpace?: boolean) => string;
declare function getDataFromError(error: Error): string;
export { panicErrorCodeToReason, getErrorCodeStringFromReason, isReasonValid, getDataFromError, formatReason, countUnicodeLettersAndNumbers };
//# sourceMappingURL=helpers.d.ts.map