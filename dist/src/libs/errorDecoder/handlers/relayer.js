/* eslint-disable class-methods-use-this */
import { RELAYER_DOWN_MESSAGE, RelayerError } from '../../relayerCall/relayerCall';
import { isReasonValid } from '../helpers';
import { ErrorType } from '../types';
class RelayerErrorHandler {
    matches(data, error) {
        const { message } = error || {};
        if (message === RELAYER_DOWN_MESSAGE)
            return true;
        return error instanceof RelayerError;
    }
    handle(data, error) {
        let reason = '';
        let finalData = '';
        if (error.message === RELAYER_DOWN_MESSAGE) {
            // Relayer is down
            reason = RELAYER_DOWN_MESSAGE;
        }
        else {
            // RPC error returned as string
            reason = error.message.match(/reason="([^"]*)"/)?.[1] || '';
            finalData = error.message.match(/data="([^"]*)"/)?.[1] || '';
            // The response isn't a stringified RPC error so the
            // reason is likely the error message
            if (!isReasonValid(reason) && !finalData) {
                reason = error.message;
            }
        }
        return {
            type: ErrorType.RelayerError,
            reason,
            data: finalData
        };
    }
}
export default RelayerErrorHandler;
//# sourceMappingURL=relayer.js.map