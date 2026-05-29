"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAddressFromAddressState = void 0;
const getAddressFromAddressState = (addressState) => {
    return (addressState.resolvedAddress || addressState.fieldValue || '').trim();
};
exports.getAddressFromAddressState = getAddressFromAddressState;
//# sourceMappingURL=domains.js.map