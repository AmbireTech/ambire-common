import { Contacts } from '../../interfaces/addressBook';
import { Domains, IDomainsController, ReverseLookupOptions } from '../../interfaces/domains';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Network } from '../../interfaces/network';
import { RPCProviders } from '../../interfaces/provider';
import { IStorageController } from '../../interfaces/storage';
import { IVerificationController } from '../../interfaces/verification';
import { NameResolver, NameServiceId } from '../../services/nameResolvers';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare const PERSIST_DOMAIN_FOR_IN_MS: number;
export declare const PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS: number;
export declare const PERSIST_EXPIRY_OF_SUBNAMES_FOR_IN_MS: number;
export declare const PERSIST_EXPIRY_FOR_IF_CLOSE_TO_DEADLINE_IN_MS: number;
/**
 * Domains controller- responsible for handling the reverse lookup of addresses to ENS names.
 * Resolved names are saved in `domains` for a short period of time(15 minutes) to avoid unnecessary lookups.
 */
export declare class DomainsController extends EventEmitter implements IDomainsController {
    #private;
    /** Stores ENS names, avatars, and metadata (timestamps) indexed by account address */
    domains: Domains;
    /** Maps domain names to account addresses; necessary because the 'domains' state
     * only indexes by address, making getting an address for an existing domain name inefficient.
     * And is also problematic if a domain name that has been resolved doesn't have a corresponding address
     * (because no one owns it). We don't want to keep trying to resolve it every time.
     */
    domainToAddresses: {
        [domain: string]: {
            address: string | undefined;
            type: NameServiceId;
        };
    };
    loadingAddresses: string[];
    resolveDomainsStatus: {
        [domain: string]: 'LOADING' | 'RESOLVED' | 'FAILED' | undefined;
    };
    resolveDomainsErrors: {
        [domain: string]: string | undefined;
    };
    verifiedDomainsStatus: {
        [domain: string]: 'VERIFIED' | undefined;
    };
    constructor({ eventEmitterRegistry, providers, verification, defaultNetworksMode, storage, featureFlags, resolvers, getNetwork }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        providers: RPCProviders;
        verification?: IVerificationController;
        defaultNetworksMode?: 'mainnet' | 'testnet';
        storage?: IStorageController;
        featureFlags?: IFeatureFlagsController;
        resolvers?: NameResolver[];
        getNetwork: (chainId: bigint) => Network | undefined;
    });
    /**
     * Initializes the controller with the data persisted in storage
     * As the domains in storage may be from one time requests in sign message/sign account op, we don't want
     * to load them all in a public variable which will be sent to the UI. Instead, we filter only the domains
     * that are in the address book, which includes accounts and address book contacts
     */
    init(contacts: Contacts): Promise<void>;
    batchReverseLookup(addresses: string[], updateExpiryForAddresses?: string[]): Promise<void>;
    /**
     * Resolves a domain and persists it to state only if resolution succeeds.
     */
    resolveDomain({ domain }: {
        domain: string;
    }): Promise<void>;
    reverseLookup(address: string, emitUpdate?: boolean, opts?: ReverseLookupOptions): Promise<void>;
    toJSON(): this & {
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=domains.d.ts.map