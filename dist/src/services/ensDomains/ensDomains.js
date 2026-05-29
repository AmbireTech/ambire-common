"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NAMOSHI_UNIVERSAL_RESOLVER = void 0;
exports.getIsNamoshiDomain = getIsNamoshiDomain;
exports.isCorrectAddress = isCorrectAddress;
exports.resolveENSDomain = resolveENSDomain;
exports.getEnsAvatar = getEnsAvatar;
exports.reverseLookupEns = reverseLookupEns;
const viem_1 = require("viem");
const ens_1 = require("viem/ens");
const provider_1 = require("@/services/provider");
const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';
const ENS_UNIVERSAL_RESOLVER = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe';
exports.NAMOSHI_UNIVERSAL_RESOLVER = '0xc5Ed1fA34AD1F23F0cD2E36DB288290488B1B493';
function getIsNamoshiDomain(domain) {
    return domain.endsWith('.btc') || domain.endsWith('.citrea');
}
function isCorrectAddress(address) {
    return !(ADDRESS_ZERO === address) && (0, viem_1.isAddress)(address);
}
/**
 * Resolves an ENS/Namoshi domain to an address and avatar.
 *
 * Can work with a custom universal resolver if the domain is a Namoshi domain, otherwise it defaults to the ENS universal resolver.
 */
async function resolveENSDomain({ provider, domain, options }) {
    const normalizedDomainName = (0, ens_1.normalize)(domain);
    if (!normalizedDomainName)
        return { address: '', avatar: null };
    const client = (0, provider_1.getViemClientForProvider)(provider);
    const [address, avatar] = await Promise.all([
        client.getEnsAddress({
            name: normalizedDomainName,
            universalResolverAddress: options?.universalResolverAddress || ENS_UNIVERSAL_RESOLVER
        }),
        client.getEnsAvatar({
            name: normalizedDomainName,
            universalResolverAddress: options?.universalResolverAddress || ENS_UNIVERSAL_RESOLVER
        })
    ]);
    return {
        address: address || '',
        avatar
    };
}
async function reverseLookupEns(address, provider, options) {
    const client = (0, provider_1.getViemClientForProvider)(provider);
    return client.getEnsName({
        address: address,
        universalResolverAddress: options?.universalResolverAddress || ENS_UNIVERSAL_RESOLVER
    });
}
async function getEnsAvatar(name, provider, options) {
    const normalizedName = (0, ens_1.normalize)(name);
    if (!normalizedName)
        return null;
    const client = (0, provider_1.getViemClientForProvider)(provider);
    return client.getEnsAvatar({
        name: normalizedName,
        universalResolverAddress: options?.universalResolverAddress || ENS_UNIVERSAL_RESOLVER
    });
}
//# sourceMappingURL=ensDomains.js.map