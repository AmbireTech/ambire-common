type AddressState = {
    fieldValue: string;
    udAddress: string;
    ensAddress: string;
    isDomainResolving: boolean;
};
type AddressStateOptional = {
    fieldValue?: AddressState['fieldValue'];
    ensAddress?: AddressState['ensAddress'];
    udAddress?: AddressState['udAddress'];
    isDomainResolving?: AddressState['isDomainResolving'];
};
export type { AddressState, AddressStateOptional };
//# sourceMappingURL=domains.d.ts.map