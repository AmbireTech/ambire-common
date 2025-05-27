import ErrorHumanizerError from '../../classes/ErrorHumanizerError';
import { DecodedError } from '../errorDecoder/types';
export declare const MESSAGE_PREFIX = "Transaction cannot be sent because";
export declare function getHumanReadableEstimationError(e: Error | DecodedError): ErrorHumanizerError;
//# sourceMappingURL=estimationErrorHumanizer.d.ts.map