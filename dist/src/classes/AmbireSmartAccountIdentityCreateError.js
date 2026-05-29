"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class AmbireSmartAccountIdentityCreateError extends Error {
    identityRequests = [];
    constructor(identityRequests) {
        super();
        this.name = 'SmartAccountIdentityCreateError';
        this.identityRequests = identityRequests;
    }
}
exports.default = AmbireSmartAccountIdentityCreateError;
//# sourceMappingURL=AmbireSmartAccountIdentityCreateError.js.map