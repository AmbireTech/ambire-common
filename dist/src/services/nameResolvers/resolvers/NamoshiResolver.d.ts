import { EnsCompatibleResolver } from './EnsCompatibleResolver';
/**
 * Namoshi names (.btc, .citrea) resolved on Citrea. No ENS registrar/NameWrapper, so no expiry.
 */
export declare class NamoshiResolver extends EnsCompatibleResolver {
    constructor();
    matches(domain: string): boolean;
}
//# sourceMappingURL=NamoshiResolver.d.ts.map