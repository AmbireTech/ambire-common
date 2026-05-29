import { DecodedError, ErrorHandler } from '../types';
declare class InternalHandler implements ErrorHandler {
    matches(data: string, error: any): error is TypeError | ReferenceError | SyntaxError | RangeError;
    handle(data: string, error: any): DecodedError;
}
export default InternalHandler;
//# sourceMappingURL=internal.d.ts.map