"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnsResolver = exports.ENS_SUBNAME_EXPIRY_TTL_IN_MS = void 0;
const ensDomains_1 = require("../../ensDomains/ensDomains");
const EnsCompatibleResolver_1 = require("./EnsCompatibleResolver");
// A wrapped ENS subname's expiry can be shortened at any time by the parent owner (setChildFuses),
// so it is re-polled on this TTL even far from the deadline, unlike a 2LD's registrar expiry.
exports.ENS_SUBNAME_EXPIRY_TTL_IN_MS = 24 * 60 * 60 * 1000;
const isEnsSubname = (name) => name.split('.').length > 2;
/**
 * Ethereum Name Service. The fallback resolver: it owns `.eth` and any DNS name not claimed by a
 * more specific service, and is the only service with a registration expiry today.
 */
class EnsResolver extends EnsCompatibleResolver_1.EnsCompatibleResolver {
    constructor() {
        super({
            id: 'ens',
            label: 'ENS',
            universalResolver: ensDomains_1.ENS_UNIVERSAL_RESOLVER,
            chainId: EnsCompatibleResolver_1.ETHEREUM_CHAIN_ID,
            isFallback: true,
            expiry: {
                baseRegistrar: ensDomains_1.ENS_BASE_REGISTRAR,
                nameWrapper: { mainnet: ensDomains_1.ENS_NAME_WRAPPER, testnet: ensDomains_1.ENS_NAME_WRAPPER_SEPOLIA }
            }
        });
    }
    matches() {
        // True because ENS resolves DNS names as well and acts as a fallback for any domain not claimed by a more specific service.
        return true;
    }
    shouldRefetchExpiry(name, cachedExpiry) {
        // Poll wrapped subnames on a TTL even far from the deadline; everything else follows the generic
        // staleness policy.
        if (isEnsSubname(name) &&
            cachedExpiry &&
            cachedExpiry.updatedAt + exports.ENS_SUBNAME_EXPIRY_TTL_IN_MS < Date.now()) {
            return true;
        }
        return super.shouldRefetchExpiry(name, cachedExpiry);
    }
}
exports.EnsResolver = EnsResolver;
//# sourceMappingURL=EnsResolver.js.map