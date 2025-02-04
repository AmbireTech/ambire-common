/* eslint-disable class-methods-use-this */
import { BICONOMY } from '../../../consts/bundlers';
import { ErrorType } from '../types';
class BiconomyEstimationErrorHandler {
    matches(data, error) {
        const { bundlerName } = error;
        return bundlerName && bundlerName === BICONOMY;
    }
    handle(data, error) {
        const { message } = error?.error || error || {};
        const lowerCased = message.toLowerCase();
        // TODO: expand with more error cases
        let reason = '';
        if (lowerCased.includes('400') || lowerCased.includes('internal error')) {
            reason = 'biconomy: 400';
        }
        return {
            type: ErrorType.BundlerError,
            reason,
            data: reason
        };
    }
}
export default BiconomyEstimationErrorHandler;
//# sourceMappingURL=biconomy.js.map