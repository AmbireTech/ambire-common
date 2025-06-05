"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeError = decodeError;
const tslib_1 = require("tslib");
const customErrors_1 = require("./customErrors");
const handlers_1 = require("./handlers");
const biconomy_1 = tslib_1.__importDefault(require("./handlers/biconomy"));
const internal_1 = tslib_1.__importDefault(require("./handlers/internal"));
const pimlico_1 = tslib_1.__importDefault(require("./handlers/pimlico"));
const relayer_1 = tslib_1.__importDefault(require("./handlers/relayer"));
const helpers_1 = require("./helpers");
const types_1 = require("./types");
// The order of these handlers is important!
// Preprocessor handlers must be ordered by least specific to most specific
// Why- because error reasons are overwritten by subsequent matching handlers
// Error handlers must be ordered by most specific to least specific
// Why- because the first valid reason cannot be overwritten by subsequent handlers
const PREPROCESSOR_BUNDLER_HANDLERS = [
    biconomy_1.default,
    pimlico_1.default
];
const PREPROCESSOR_HANDLERS = [handlers_1.BundlerErrorHandler, relayer_1.default, handlers_1.InnerCallFailureHandler];
const ERROR_HANDLERS = [
    internal_1.default,
    handlers_1.RpcErrorHandler,
    handlers_1.CustomErrorHandler,
    handlers_1.PanicErrorHandler,
    handlers_1.RevertErrorHandler,
    handlers_1.PaymasterErrorHandler,
    handlers_1.UserRejectionHandler
];
// additionalHandlers is a list of handlers we want to add only for
// specific decodeError cases (e.g. bundler estimation)
function decodeError(e) {
    const errorData = (0, helpers_1.getDataFromError)(e);
    let decodedError = {
        type: types_1.ErrorType.UnknownError,
        reason: '',
        data: errorData
    };
    // configure a list of preprocessorHandlers we want to use.
    // There are very generic errors like 400 bad request that when they come
    // from a bundler that mean one thing but from an RPC another, and from the relayer
    // a third. So we will add additional handlers optionally
    const preprocessorHandlers = PREPROCESSOR_HANDLERS;
    if (e instanceof customErrors_1.BundlerError) {
        preprocessorHandlers.unshift(...PREPROCESSOR_BUNDLER_HANDLERS);
    }
    // Run preprocessor handlers first
    // The idea is that preprocessor handlers can either decode the error
    // or leave it partially decoded for the other handlers to decode
    preprocessorHandlers.forEach((HandlerClass) => {
        const handler = new HandlerClass();
        if (handler.matches(errorData, e)) {
            decodedError = handler.handle(errorData, e);
        }
    });
    // Run error handlers
    ERROR_HANDLERS.forEach((HandlerClass) => {
        const handler = new HandlerClass();
        const isValidReason = (0, helpers_1.isReasonValid)(decodedError.reason);
        const processedData = decodedError.data || errorData;
        if (handler.matches(processedData, e) && !isValidReason) {
            decodedError = handler.handle(processedData, e);
        }
    });
    decodedError.reason = (0, helpers_1.formatReason)(decodedError.reason || '');
    if (decodedError.type === types_1.ErrorType.UnknownError) {
        console.error('Failed to decode error', e);
    }
    return decodedError;
}
//# sourceMappingURL=errorDecoder.js.map