import { DecodedError, ErrorHandler } from '../types';
declare class PanicErrorHandler implements ErrorHandler {
    matches(data: string): boolean;
    handle(data: string): DecodedError;
}
export default PanicErrorHandler;
//# sourceMappingURL=panic.d.ts.map