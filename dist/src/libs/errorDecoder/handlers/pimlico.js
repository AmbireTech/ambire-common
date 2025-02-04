/* eslint-disable class-methods-use-this */
import { PIMLICO } from '../../../consts/bundlers';
import { ErrorType } from '../types';
class PimlicoEstimationErrorHandler {
    matches(data, error) {
        const { bundlerName } = error;
        return bundlerName && bundlerName === PIMLICO;
    }
    handle(data, error) {
        const { message } = error?.error || error || {};
        const lowerCased = message.toLowerCase();
        // TODO: expand with more error cases
        let reason = '';
        if (lowerCased.includes('internal error')) {
            reason = 'pimlico: 500';
        }
        return {
            type: ErrorType.BundlerError,
            reason,
            data: reason
        };
    }
}
export default PimlicoEstimationErrorHandler;
//# sourceMappingURL=pimlico.js.map