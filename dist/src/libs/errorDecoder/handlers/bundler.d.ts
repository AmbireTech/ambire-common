import { DecodedError, ErrorHandler } from '../types';
declare class BundlerErrorHandler implements ErrorHandler {
    matches(data: string, error: any): any;
    handle(data: string, error: any): DecodedError;
}
export default BundlerErrorHandler;
//# sourceMappingURL=bundler.d.ts.map