"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class SwapAndBridgeProviderApiError extends Error {
    shortMessage;
    constructor(message, shortMessage) {
        super();
        this.name = 'SwapAndBridgeProviderApiError';
        this.message = message;
        this.shortMessage = shortMessage;
    }
}
exports.default = SwapAndBridgeProviderApiError;
//# sourceMappingURL=SwapAndBridgeProviderApiError.js.map