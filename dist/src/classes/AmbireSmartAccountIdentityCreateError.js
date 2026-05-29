export default class AmbireSmartAccountIdentityCreateError extends Error {
    identityRequests = [];
    constructor(identityRequests) {
        super();
        this.name = 'SmartAccountIdentityCreateError';
        this.identityRequests = identityRequests;
    }
}
//# sourceMappingURL=AmbireSmartAccountIdentityCreateError.js.map