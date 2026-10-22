"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderError = void 0;
const networks_1 = require("../consts/networks");
class ProviderError extends Error {
    isProviderInvictus;
    providerUrl;
    statusCode;
    code;
    constructor({ originalError, providerUrl }) {
        super(originalError.message);
        // Copy all properties from the original error to this error
        Object.assign(this, originalError);
        const statusCode = originalError?.response?.statusCode;
        const isProviderInvictus = providerUrl?.includes(networks_1.INVICTUS_RPC_URL_IDENTIFIER);
        this.name = 'ProviderError';
        this.providerUrl = providerUrl;
        this.isProviderInvictus = isProviderInvictus;
        this.statusCode = statusCode;
    }
}
exports.ProviderError = ProviderError;
//# sourceMappingURL=ProviderError.js.map