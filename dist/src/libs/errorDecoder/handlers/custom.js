/* eslint-disable class-methods-use-this */
import { ERROR_PREFIX, PANIC_ERROR_PREFIX } from '../constants';
import { ErrorType } from '../types';
/** Handles custom errors thrown by contracts */
class CustomErrorHandler {
    matches(data) {
        return (!!data &&
            data !== '0x' &&
            !data?.startsWith(ERROR_PREFIX) &&
            !data?.startsWith(PANIC_ERROR_PREFIX));
    }
    handle(data) {
        return {
            type: ErrorType.CustomError,
            // Custom errors do not provide a specific reason.
            // Therefore, we return the raw data in hexadecimal format,
            // which can be used to map to a corresponding error message.
            reason: data,
            data
        };
    }
}
export default CustomErrorHandler;
//# sourceMappingURL=custom.js.map