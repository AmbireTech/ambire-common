import { DecodedError, ErrorType } from '../errorDecoder/types';
import { ErrorHumanizerError } from './types';
declare function getGenericMessageFromType(errorType: ErrorType, reason: DecodedError['reason'], messagePrefix: string, lastResortMessage: string): string;
declare const getHumanReadableErrorMessage: (commonError: string | null, errors: ErrorHumanizerError[], messagePrefix: string, reason: DecodedError['reason'], e: any) => string | null;
export { getGenericMessageFromType, getHumanReadableErrorMessage };
//# sourceMappingURL=helpers.d.ts.map