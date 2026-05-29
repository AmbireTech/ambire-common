import { ControllerInterface } from './controller';
export type IDomainsController = ControllerInterface<InstanceType<typeof import('../controllers/domains/domains').DomainsController>>;
type AddressState = {
    fieldValue: string;
    resolvedAddress: string;
    resolvedAddressType: 'ens' | 'namoshi' | null;
    isDomainResolving: boolean;
};
type AddressStateOptional = {
    fieldValue?: AddressState['fieldValue'];
    resolvedAddress?: AddressState['resolvedAddress'];
    resolvedAddressType?: AddressState['resolvedAddressType'];
    isDomainResolving?: AddressState['isDomainResolving'];
};
export type { AddressState, AddressStateOptional };
//# sourceMappingURL=domains.d.ts.map