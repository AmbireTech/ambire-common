"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnsCompatibleResolver = exports.ETHEREUM_CHAIN_ID = void 0;
const ens_1 = require("viem/ens");
const ensDomains_1 = require("../../ensDomains/ensDomains");
const expiry_1 = require("../expiry");
exports.ETHEREUM_CHAIN_ID = { mainnet: '1', testnet: '11155111' };
/**
 * Shared implementation for ENS and ENS-compatible services: same universal-resolver interface, a
 * different contract address and, optionally, a different chain.
 */
class EnsCompatibleResolver {
    id;
    label;
    featureFlag;
    isFallback;
    capabilities;
    universalResolver;
    chainId;
    expiryConfig;
    constructor(config) {
        this.id = config.id;
        this.label = config.label;
        this.featureFlag = config.featureFlag;
        this.isFallback = config.isFallback ?? false;
        this.universalResolver = config.universalResolver;
        this.chainId = config.chainId;
        this.expiryConfig = config.expiry;
        this.capabilities = { reverse: true, avatar: true, expiry: !!config.expiry };
    }
    /**
     * ENS-compatible services share ENSIP-15 (UTS-46) normalization.
     */
    normalize(domain) {
        try {
            return (0, ens_1.normalize)(domain.trim()) || null;
        }
        catch {
            return null;
        }
    }
    requiredChainId(networkMode) {
        return this.chainId[networkMode];
    }
    providerFor(ctx) {
        return ctx.getProvider(this.chainId[ctx.networkMode]);
    }
    async resolve(domain, ctx, options) {
        const provider = this.providerFor(ctx);
        if (!provider)
            return null;
        return (0, ensDomains_1.resolveENSDomain)({
            provider,
            domain,
            options: {
                resolveAvatar: options?.resolveAvatar,
                universalResolverAddress: this.universalResolver,
                expiry: this.expiryConfig
                    ? {
                        baseRegistrar: this.expiryConfig.baseRegistrar,
                        nameWrapper: this.expiryConfig.nameWrapper[ctx.networkMode]
                    }
                    : null
            }
        });
    }
    async reverse(addresses, ctx) {
        const provider = this.providerFor(ctx);
        // A missing provider is transient/config-dependent, so flag the batch as failed (the controller
        // retries on failure) rather than caching a "no name" result.
        if (!provider)
            return Object.fromEntries(addresses.map((a) => [a, { name: null, failed: true }]));
        return (0, ensDomains_1.reverseLookupEns)(addresses, provider, {
            universalResolverAddress: this.universalResolver
        });
    }
    async getAvatar(name, ctx) {
        const provider = this.providerFor(ctx);
        if (!provider)
            return null;
        return (0, ensDomains_1.getEnsAvatar)(name, provider, { universalResolverAddress: this.universalResolver });
    }
    async getExpiry(name, ctx) {
        if (!this.expiryConfig)
            return null;
        const provider = this.providerFor(ctx);
        if (!provider)
            return null;
        return (0, ensDomains_1.getEnsExpiry)(provider, {
            name,
            addresses: {
                baseRegistrar: this.expiryConfig.baseRegistrar,
                nameWrapper: this.expiryConfig.nameWrapper[ctx.networkMode]
            }
        });
    }
    shouldRefetchExpiry(_name, cachedExpiry) {
        return (0, expiry_1.isNameExpiryStale)(cachedExpiry);
    }
}
exports.EnsCompatibleResolver = EnsCompatibleResolver;
//# sourceMappingURL=EnsCompatibleResolver.js.map