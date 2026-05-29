import { IDomainsController } from '../../interfaces/domains';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { RPCProviders } from '../../interfaces/provider';
import EventEmitter from '../eventEmitter/eventEmitter';
interface Domains {
    [address: string]: {
        ens: string | null;
        /**
         * Namoshi domains are fully compatible with the ENS implementation, they just use a different universal resolver contract
         * and have different TLDs (.btc and .citrea).
         */
        namoshi: string | null;
        /**
         * ENS or Namoshi avatar URL
         */
        ensAvatar?: string | null;
        createdAt?: number;
        updatedAt?: number;
        updateFailedAt?: number;
    };
}
export declare const PERSIST_DOMAIN_FOR_IN_MS: number;
export declare const PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS: number;
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
            type: 'ens' | 'namoshi';
        };
    };
    loadingAddresses: string[];
    resolveDomainsStatus: {
        [domain: string]: 'LOADING' | 'RESOLVED' | 'FAILED' | undefined;
    };
    constructor({ eventEmitterRegistry, providers, defaultNetworksMode }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        providers: RPCProviders;
        defaultNetworksMode?: 'mainnet' | 'testnet';
    });
    batchReverseLookup(addresses: string[]): Promise<void>;
    /**
     * Resolves an ENS domain and persists it to state only if resolution succeeds.
     */
    resolveDomain({ domain }: {
        domain: string;
    }): Promise<void>;
    reverseLookup(address: string, emitUpdate?: boolean): Promise<void>;
    toJSON(): this & {
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=domains.d.ts.map