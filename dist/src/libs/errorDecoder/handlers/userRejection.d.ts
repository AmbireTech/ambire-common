import { DecodedError, ErrorHandler } from '../types';
export declare const USER_REJECTED_TRANSACTION_ERROR_CODE = 4001;
export declare const TRANSACTION_REJECTED_REASON = "transaction-rejected";
declare class UserRejectionHandler implements ErrorHandler {
    matches(data: string, error: any): any;
    handle(data: string): DecodedError;
}
export default UserRejectionHandler;
//# sourceMappingURL=userRejection.d.ts.map