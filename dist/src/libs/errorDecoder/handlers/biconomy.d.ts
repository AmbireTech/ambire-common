import { DecodedError, ErrorHandler } from '../types';
declare class BiconomyEstimationErrorHandler implements ErrorHandler {
    matches(data: string, error: any): any;
    handle(data: string, error: any): DecodedError;
}
export default BiconomyEstimationErrorHandler;
//# sourceMappingURL=biconomy.d.ts.map