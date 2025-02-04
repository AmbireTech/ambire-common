import { DecodedError, ErrorHandler } from '../types';
/** Handles custom errors thrown by contracts */
declare class CustomErrorHandler implements ErrorHandler {
    matches(data: string): boolean;
    handle(data: string): DecodedError;
}
export default CustomErrorHandler;
//# sourceMappingURL=custom.d.ts.map