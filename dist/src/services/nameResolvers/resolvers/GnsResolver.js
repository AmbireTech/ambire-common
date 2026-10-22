"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GnsResolver = void 0;
const EnsCompatibleResolver_1 = require("./EnsCompatibleResolver");
// GNS universal resolver; same address on Ethereum mainnet and Sepolia. ENS-compatible.
const GNS_UNIVERSAL_RESOLVER = '0xD658131FFB6D732335d37f199374289F1b31564F';
/**
 * GNS names (.gwei) resolved on Ethereum. Ownerless, no registrar/NameWrapper, so no expiry.
 */
class GnsResolver extends EnsCompatibleResolver_1.EnsCompatibleResolver {
    constructor() {
        super({
            id: 'gns',
            label: 'GNS',
            universalResolver: GNS_UNIVERSAL_RESOLVER,
            chainId: EnsCompatibleResolver_1.ETHEREUM_CHAIN_ID,
            featureFlag: 'gnsDomains'
        });
    }
    matches(domain) {
        return domain.trim().toLowerCase().endsWith('.gwei');
    }
}
exports.GnsResolver = GnsResolver;
//# sourceMappingURL=GnsResolver.js.map