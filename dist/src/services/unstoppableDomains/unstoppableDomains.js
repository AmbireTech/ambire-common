"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reverseLookupUD = exports.resolveUDomain = void 0;
const resolution_1 = require("@unstoppabledomains/resolution");
const networks_1 = require("../../consts/networks");
// @TODO: Get RPC urls from settings controller
const resolution = new resolution_1.Resolution({
    sourceConfig: {
        uns: {
            locations: {
                Layer1: {
                    url: networks_1.networks.find((x) => x.id === 'ethereum')?.rpcUrls?.[0] || '',
                    network: 'mainnet'
                },
                Layer2: {
                    url: networks_1.networks.find((x) => x.id === 'polygon')?.rpcUrls?.[0] || '',
                    network: 'polygon-mainnet'
                }
            }
        }
    }
});
function getMessage(e) {
    if (e === 'UnregisteredDomain')
        return 'Domain is not registered';
    if (e === 'RecordNotFound')
        return 'Crypto record is not found (or empty)';
    if (e === 'UnspecifiedResolver')
        return 'Domain is not configured (empty resolver)';
    if (e === 'UnsupportedDomain')
        return 'Domain is not supported';
    return 'Domain is not registered';
}
async function resolveAddress(domain) {
    return resolution
        .addr(domain, 'ETH')
        .then((addr) => ({ success: true, address: addr }))
        .catch((e) => ({ success: false, code: e.code, message: getMessage(e.code) }));
}
async function resolveAddressMultiChain(domain, currency, chain) {
    return resolution
        .multiChainAddr(domain, currency, chain)
        .then((addr) => ({ success: true, address: addr }))
        .catch((e) => ({ success: false, code: e.code, message: getMessage(e.code) }));
}
async function resolveUDomain(domain, currency, chain) {
    const [nativeUDAddress, customUDAddress] = await Promise.all([
        resolveAddress(domain),
        resolveAddressMultiChain(domain, currency, chain)
    ]);
    if (customUDAddress.success && 'address' in customUDAddress && customUDAddress.address) {
        return customUDAddress.address;
    }
    if (nativeUDAddress.success && 'address' in nativeUDAddress && nativeUDAddress.address) {
        return nativeUDAddress.address;
    }
    return '';
}
exports.resolveUDomain = resolveUDomain;
async function reverseLookupUD(address) {
    return resolution.reverse(address);
}
exports.reverseLookupUD = reverseLookupUD;
//# sourceMappingURL=unstoppableDomains.js.map