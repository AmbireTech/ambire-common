"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResolvedDomainName = exports.getDomainFromAddressState = exports.getAddressFromAddressState = void 0;
const getAddressCaught_1 = require("./getAddressCaught");
const getAddressFromAddressState = (addressState) => {
    return (addressState.resolvedAddress || addressState.fieldValue || '').trim();
};
exports.getAddressFromAddressState = getAddressFromAddressState;
const getDomainFromAddressState = (addressState) => {
    if (!addressState.resolvedAddressType)
        return undefined;
    const normalized = addressState.fieldValue.toLowerCase().trim();
    return !!normalized ? normalized : undefined;
};
exports.getDomainFromAddressState = getDomainFromAddressState;
/**
 * Finds the normalized domain name matching the address state's resolved address and service type, if any.
 */
const getResolvedDomainName = (domains, addressState) => {
    const { resolvedAddress, resolvedAddressType } = addressState;
    if (!resolvedAddress || !resolvedAddressType)
        return undefined;
    return domains[(0, getAddressCaught_1.getAddressCaught)(resolvedAddress)]?.names?.[resolvedAddressType] ?? undefined;
};
exports.getResolvedDomainName = getResolvedDomainName;
//# sourceMappingURL=domains.js.map