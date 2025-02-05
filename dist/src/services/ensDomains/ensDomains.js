"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reverseLookupEns = exports.getBip44Items = exports.resolveENSDomain = exports.isCorrectAddress = void 0;
const tslib_1 = require("tslib");
// @ts-ignore
const bip44_constants_1 = tslib_1.__importDefault(require("bip44-constants"));
const ethers_1 = require("ethers");
// @ts-ignore
const eth_ens_namehash_1 = require("@ensdomains/eth-ens-namehash");
const networks_1 = require("../../consts/networks");
const provider_1 = require("../provider");
const BIP44_BASE_VALUE = 2147483648;
const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';
const normalizeDomain = (domain) => {
    try {
        return (0, eth_ens_namehash_1.normalize)(domain);
    }
    catch (e) {
        return null;
    }
};
function getNormalisedCoinType(bip44Item) {
    return bip44Item[0].length ? bip44Item[0][0] - BIP44_BASE_VALUE : null;
}
async function resolveForCoin(resolver, bip44Item) {
    if (bip44Item && bip44Item.length === 1) {
        const coinType = getNormalisedCoinType(bip44Item);
        if (!coinType)
            return null;
        return resolver.getAddress(coinType);
    }
    return resolver.getAddress();
}
function isCorrectAddress(address) {
    return !(ADDRESS_ZERO === address) && (0, ethers_1.isAddress)(address);
}
exports.isCorrectAddress = isCorrectAddress;
// @TODO: Get RPC provider url from settings controller
async function resolveENSDomain(domain, bip44Item) {
    const normalizedDomainName = normalizeDomain(domain);
    if (!normalizedDomainName)
        return '';
    const ethereum = networks_1.networks.find((x) => x.id === 'ethereum');
    const provider = (0, provider_1.getRpcProvider)(ethereum.rpcUrls, ethereum.chainId);
    const resolver = await provider.getResolver(normalizedDomainName);
    if (!resolver)
        return '';
    try {
        const ethAddress = await resolver.getAddress();
        const addressForCoin = await resolveForCoin(resolver, bip44Item).catch(() => null);
        return isCorrectAddress(addressForCoin) ? addressForCoin : ethAddress;
    }
    catch (e) {
        // If the error comes from an internal server error don't
        // show it to the user, because it happens when a domain
        // doesn't exist and we already show a message for that.
        // https://dnssec-oracle.ens.domains/ 500 (ISE)
        if (e.message?.includes('500_SERVER_ERROR'))
            return '';
        throw e;
    }
    finally {
        provider?.destroy();
    }
}
exports.resolveENSDomain = resolveENSDomain;
function getBip44Items(coinTicker) {
    if (!coinTicker)
        return null;
    return bip44_constants_1.default.filter((item) => item[1] === coinTicker);
}
exports.getBip44Items = getBip44Items;
async function reverseLookupEns(address, provider) {
    return provider.lookupAddress(address);
}
exports.reverseLookupEns = reverseLookupEns;
//# sourceMappingURL=ensDomains.js.map