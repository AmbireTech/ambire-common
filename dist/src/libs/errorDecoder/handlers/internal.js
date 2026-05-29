import { ErrorType } from '../types';
const CONNECTIVITY_REASONS = ['Failed to fetch', 'NetworkError', 'Failed to load'];
class InternalHandler {
    matches(data, error) {
        return (error instanceof TypeError ||
            error instanceof ReferenceError ||
            error instanceof SyntaxError ||
            error instanceof RangeError);
    }
    handle(data, error) {
        const isConnectivityError = CONNECTIVITY_REASONS.some((reason) => error.message?.includes(reason));
        if (isConnectivityError) {
            return {
                type: ErrorType.ConnectivityError,
                reason: 'ConnectivityError',
                data: error.message
            };
        }
        return {
            type: ErrorType.CodeError,
            reason: error.name,
            data
        };
    }
}
export default InternalHandler;
//# sourceMappingURL=internal.js.map