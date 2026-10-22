import { NameExpiry } from '../../ensDomains/ensDomains';
import { EnsCompatibleResolver } from './EnsCompatibleResolver';
export declare const ENS_SUBNAME_EXPIRY_TTL_IN_MS: number;
/**
 * Ethereum Name Service. The fallback resolver: it owns `.eth` and any DNS name not claimed by a
 * more specific service, and is the only service with a registration expiry today.
 */
export declare class EnsResolver extends EnsCompatibleResolver {
    constructor();
    matches(): boolean;
    shouldRefetchExpiry(name: string, cachedExpiry: NameExpiry | null | undefined): boolean;
}
//# sourceMappingURL=EnsResolver.d.ts.map