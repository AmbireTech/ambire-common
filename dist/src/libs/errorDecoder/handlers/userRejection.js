/* eslint-disable class-methods-use-this */
import { ErrorType } from '../types';
export const USER_REJECTED_TRANSACTION_ERROR_CODE = 4001;
export const TRANSACTION_REJECTED_REASON = 'transaction-rejected';
class UserRejectionHandler {
    matches(data, error) {
        return (!data &&
            (error?.message?.includes('rejected transaction') ||
                error?.code === USER_REJECTED_TRANSACTION_ERROR_CODE));
    }
    handle(data) {
        return {
            type: ErrorType.UserRejectionError,
            reason: TRANSACTION_REJECTED_REASON,
            data
        };
    }
}
export default UserRejectionHandler;
//# sourceMappingURL=userRejection.js.map