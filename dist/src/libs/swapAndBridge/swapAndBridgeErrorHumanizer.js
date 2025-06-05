"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHumanReadableSwapAndBridgeError = getHumanReadableSwapAndBridgeError;
const tslib_1 = require("tslib");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const SwapAndBridgeError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeError"));
const SwapAndBridgeProviderApiError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeProviderApiError"));
const MSG_MAX_LENGTH = 225;
function getHumanReadableSwapAndBridgeError(e) {
    // These errors should be thrown as they are
    // as they are already human-readable
    if (e instanceof EmittableError_1.default ||
        e instanceof SwapAndBridgeProviderApiError_1.default ||
        e instanceof SwapAndBridgeError_1.default) {
        return e;
    }
    // Last resort (fallback) error handling
    let message = e?.message || 'no details';
    // Protection against crazy long error messages
    if (message.length > MSG_MAX_LENGTH)
        message = `${message.substring(0, MSG_MAX_LENGTH)}...`;
    const errorMessage = `Unexpected error happened in the Swap & Bridge flow. Try again later or contact Ambire support. Details: <${message}>`;
    return new Error(errorMessage);
}
//# sourceMappingURL=swapAndBridgeErrorHumanizer.js.map