export default class SwapAndBridgeProviderApiError extends Error {
    shortMessage;
    constructor(message, shortMessage) {
        super();
        this.name = 'SwapAndBridgeProviderApiError';
        this.message = message;
        this.shortMessage = shortMessage;
    }
}
//# sourceMappingURL=SwapAndBridgeProviderApiError.js.map