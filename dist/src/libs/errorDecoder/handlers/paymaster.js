/* eslint-disable class-methods-use-this */
import { ErrorType } from '../types';
class PaymasterErrorHandler {
    matches(data, error) {
        const { name } = error;
        return name === 'PaymasterError' || name === 'PaymasterSponsorshipError';
    }
    handle(data, error) {
        const { message: reason } = error;
        return {
            type: ErrorType.PaymasterError,
            reason,
            data: ''
        };
    }
}
export default PaymasterErrorHandler;
//# sourceMappingURL=paymaster.js.map