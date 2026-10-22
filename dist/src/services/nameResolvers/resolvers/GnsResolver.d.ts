import { EnsCompatibleResolver } from './EnsCompatibleResolver';
/**
 * GNS names (.gwei) resolved on Ethereum. Ownerless, no registrar/NameWrapper, so no expiry.
 */
export declare class GnsResolver extends EnsCompatibleResolver {
    constructor();
    matches(domain: string): boolean;
}
//# sourceMappingURL=GnsResolver.d.ts.map