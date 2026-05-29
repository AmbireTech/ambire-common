export class ProviderError extends Error {
    isProviderInvictus;
    providerUrl;
    statusCode;
    code;
    constructor({ originalError, providerUrl }) {
        super(originalError.message);
        // Copy all properties from the original error to this error
        Object.assign(this, originalError);
        const statusCode = originalError?.response?.statusCode;
        const isProviderInvictus = providerUrl?.includes('invictus');
        this.name = 'ProviderError';
        this.providerUrl = providerUrl;
        this.isProviderInvictus = isProviderInvictus;
        this.statusCode = statusCode;
    }
}
//# sourceMappingURL=ProviderError.js.map