import { DecodedError, ErrorHandler } from '../types';
declare class RevertErrorHandler implements ErrorHandler {
    matches(data: string): boolean;
    handle(data: string): DecodedError;
}
export default RevertErrorHandler;
//# sourceMappingURL=revert.d.ts.map