import { DecodedError, ErrorHandler } from '../types';
declare class RelayerErrorHandler implements ErrorHandler {
    matches(data: string, error: any): boolean;
    handle(data: string, error: any): DecodedError;
}
export default RelayerErrorHandler;
//# sourceMappingURL=relayer.d.ts.map