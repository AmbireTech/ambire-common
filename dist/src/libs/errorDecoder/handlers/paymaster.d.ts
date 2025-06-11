import { DecodedError, ErrorHandler } from '../types';
declare class PaymasterErrorHandler implements ErrorHandler {
    matches(data: string, error: any): boolean;
    handle(data: string, error: any): DecodedError;
}
export default PaymasterErrorHandler;
//# sourceMappingURL=paymaster.d.ts.map