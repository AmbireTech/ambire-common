"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable class-methods-use-this */
const relayerCall_1 = require("../../relayerCall/relayerCall");
const helpers_1 = require("../helpers");
const types_1 = require("../types");
class RelayerErrorHandler {
    matches(data, error) {
        const { message } = error || {};
        if (message === relayerCall_1.RELAYER_DOWN_MESSAGE)
            return true;
        return error instanceof relayerCall_1.RelayerError;
    }
    handle(data, error) {
        let reason = '';
        let finalData = '';
        if (error.message === relayerCall_1.RELAYER_DOWN_MESSAGE) {
            // Relayer is down
            reason = relayerCall_1.RELAYER_DOWN_MESSAGE;
        }
        else {
            // RPC error returned as string
            reason = error.message.match(/reason="([^"]*)"/)?.[1] || '';
            finalData = error.message.match(/data="([^"]*)"/)?.[1] || '';
            // The response isn't a stringified RPC error so the
            // reason is likely the error message
            if (!(0, helpers_1.isReasonValid)(reason) && !finalData) {
                reason = error.message;
            }
        }
        return {
            type: types_1.ErrorType.RelayerError,
            reason,
            data: finalData
        };
    }
}
exports.default = RelayerErrorHandler;
//# sourceMappingURL=relayer.js.map