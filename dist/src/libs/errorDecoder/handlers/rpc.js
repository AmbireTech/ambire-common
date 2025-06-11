"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RPC_HARDCODED_ERRORS = void 0;
/* eslint-disable class-methods-use-this */
const helpers_1 = require("../helpers");
const types_1 = require("../types");
const userRejection_1 = require("./userRejection");
exports.RPC_HARDCODED_ERRORS = {
    rpcTimeout: 'rpc-timeout'
};
class RpcErrorHandler {
    matches(data, error) {
        // This is the only case in which we want to check for a specific error message
        // because it's a custom error that should be handled as an RPC error
        if (error?.message === exports.RPC_HARDCODED_ERRORS.rpcTimeout)
            return true;
        return (!data &&
            !!error.message &&
            !error?.message?.includes('rejected transaction') &&
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            error?.code !== undefined &&
            error.code !== userRejection_1.USER_REJECTED_TRANSACTION_ERROR_CODE);
    }
    handle(data, error) {
        const rpcError = error;
        // The order is important here, we want to prioritize the most relevant reason
        // Also, we do it this way as the reason can be in different places depending on the error
        const possibleReasons = [
            rpcError.code,
            rpcError.shortMessage,
            rpcError.message,
            rpcError.info?.error?.message,
            rpcError.error?.message
        ];
        const reason = possibleReasons.find((r) => !!r && (0, helpers_1.isReasonValid)(r)) || '';
        return {
            type: types_1.ErrorType.RpcError,
            reason,
            data
        };
    }
}
exports.default = RpcErrorHandler;
//# sourceMappingURL=rpc.js.map