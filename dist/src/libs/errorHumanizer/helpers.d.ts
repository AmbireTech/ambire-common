import { DecodedError, ErrorType } from '../errorDecoder/types';
import { ErrorHumanizerError } from './types';
/**
 * If we fail to match the error reason to a human-readable error,
 * we return a generic message based on the error type.
 * This is a last resort to provide some context to the user.
 * The returned error message will contain the error reason if available
 */
declare function getGenericMessageFromType(errorType: ErrorType, reason: DecodedError['reason'], messagePrefix: string, lastResortMessage: string, originalError?: any, withReason?: boolean): string;
/**
 * A function that takes information about an error and attempts to return a human-readable error message by
 * matching the error reason against a list of known errors.
 */
declare const getHumanReadableErrorMessage: (commonError: string | null, errors: ErrorHumanizerError[], messagePrefix: string, decodedError: DecodedError, e: any) => string | null;
export { getGenericMessageFromType, getHumanReadableErrorMessage };
//# sourceMappingURL=helpers.d.ts.map