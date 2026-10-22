import { AddressState, Domains } from '../interfaces/domains';
declare const getAddressFromAddressState: (addressState: Pick<AddressState, "resolvedAddress" | "fieldValue">) => string;
declare const getDomainFromAddressState: (addressState: Pick<AddressState, "resolvedAddressType" | "fieldValue">) => string;
/**
 * Finds the normalized domain name matching the address state's resolved address and service type, if any.
 */
declare const getResolvedDomainName: (domains: Domains, addressState: Pick<AddressState, "resolvedAddress" | "resolvedAddressType">) => string | undefined;
export { getAddressFromAddressState, getDomainFromAddressState, getResolvedDomainName };
//# sourceMappingURL=domains.d.ts.map