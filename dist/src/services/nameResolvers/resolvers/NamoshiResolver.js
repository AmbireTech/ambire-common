"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NamoshiResolver = void 0;
const EnsCompatibleResolver_1 = require("./EnsCompatibleResolver");
// Namoshi universal resolver on Citrea; ENS-compatible, so it reuses the ENS resolution path.
const NAMOSHI_UNIVERSAL_RESOLVER = '0xc5Ed1fA34AD1F23F0cD2E36DB288290488B1B493';
const CITREA_CHAIN_ID = { mainnet: '4114', testnet: '5115' };
/**
 * Namoshi names (.btc, .citrea) resolved on Citrea. No ENS registrar/NameWrapper, so no expiry.
 */
class NamoshiResolver extends EnsCompatibleResolver_1.EnsCompatibleResolver {
    constructor() {
        super({
            id: 'namoshi',
            label: 'Namoshi',
            universalResolver: NAMOSHI_UNIVERSAL_RESOLVER,
            chainId: CITREA_CHAIN_ID,
            featureFlag: 'namoshiDomains'
        });
    }
    matches(domain) {
        const tld = domain.trim().toLowerCase();
        return tld.endsWith('.btc') || tld.endsWith('.citrea');
    }
}
exports.NamoshiResolver = NamoshiResolver;
//# sourceMappingURL=NamoshiResolver.js.map