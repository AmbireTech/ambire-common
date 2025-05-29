import { RPCProviders } from '../../interfaces/provider';
import EventEmitter from '../eventEmitter/eventEmitter';
interface Domains {
    [address: string]: {
        ens: string | null;
        savedAt: number;
    };
}
/**
 * Domains controller- responsible for handling the reverse lookup of addresses to ENS names.
 * Resolved names are saved in `domains` for a short period of time(15 minutes) to avoid unnecessary lookups.
 */
export declare class DomainsController extends EventEmitter {
    #private;
    domains: Domains;
    loadingAddresses: string[];
    constructor(providers: RPCProviders);
    batchReverseLookup(addresses: string[]): Promise<void>;
    /**
     *Saves an already resolved ENS name for an address.
     */
    saveResolvedReverseLookup({ address, name, type }: {
        address: string;
        name: string;
        type: 'ens';
    }): void;
    /**
     * Resolves the ENS names for an address if such exist.
     */
    reverseLookup(address: string, emitUpdate?: boolean): Promise<void>;
}
export {};
//# sourceMappingURL=domains.d.ts.map