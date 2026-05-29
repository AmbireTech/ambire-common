import { DecodedError, ErrorHandler, ErrorType } from '../types';
declare class InnerCallFailureHandler implements ErrorHandler {
    type: ErrorType;
    matches(data: string, error: Error): boolean;
    handle(data: string, error: Error): DecodedError;
}
export default InnerCallFailureHandler;
//# sourceMappingURL=innerCallFailure.d.ts.map