"use strict";
// @ts-nocheck
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENS_NAME_WRAPPER_SEPOLIA = exports.ENS_NAME_WRAPPER = exports.ENS_BASE_REGISTRAR = exports.ENS_EXPIRY_WARN_WINDOW_IN_MS = exports.ENS_UNIVERSAL_RESOLVER = void 0;
exports.isCorrectAddress = isCorrectAddress;
exports.resolveENSDomain = resolveENSDomain;
exports.getEnsAvatar = getEnsAvatar;
exports.reverseLookupEns = reverseLookupEns;
exports.getEnsExpiry = getEnsExpiry;
const tslib_1 = require("tslib");
const viem_1 = require("viem");
const ens_1 = require("viem/ens");
const deployless_1 = require("../../libs/deployless/deployless");
const provider_1 = require("../provider");
const EnsGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/EnsGetter.json"));
const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';
exports.ENS_UNIVERSAL_RESOLVER = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe';
exports.ENS_EXPIRY_WARN_WINDOW_IN_MS = 60 * 24 * 60 * 60 * 1000;
const LOCAL_BATCH_GATEWAY_URL = 'x-batch-gateway:true';
const ETHEREUM_COIN_TYPE = 60n;
const REVERSE_LOOKUP_CHUNK_SIZE = 50;
// .eth BaseRegistrar (mainnet and sepolia share the same address).
exports.ENS_BASE_REGISTRAR = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85';
// NameWrapper. Stores expiry for wrapped names, including subnames. For a wrapped `.eth` 2LD, its
// expiry already includes the grace-period offset, so no extra grace is added on that path.
exports.ENS_NAME_WRAPPER = '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401';
exports.ENS_NAME_WRAPPER_SEPOLIA = '0x0635513f179D50A207757E05759CbD106d7dFcE8';
function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}
function isCorrectAddress(address) {
    return !(ADDRESS_ZERO === address) && (0, viem_1.isAddress)(address);
}
/**
 * Resolves an ENS(-compatible) domain to an address, avatar and, for services that have an ENS
 * registrar/NameWrapper, its registration expiry. The universal resolver to query defaults to the
 * ENS one; ENS-compatible services (Namoshi, GNS) pass their own.
 */
async function resolveENSDomain({ provider, domain, options }) {
    const normalizedDomainName = (0, ens_1.normalize)(domain);
    if (!normalizedDomainName)
        return { address: '', avatar: null, expiry: null };
    const client = (0, provider_1.getViemClientForProvider)(provider);
    const universalResolverAddress = options?.universalResolverAddress ?? exports.ENS_UNIVERSAL_RESOLVER;
    const skipAvatar = options?.resolveAvatar === false;
    const skipExpiry = options?.expiry === null;
    const [address, avatar, expiry] = await Promise.all([
        (0, ens_1.getEnsAddress)(client, { name: normalizedDomainName, universalResolverAddress }),
        skipAvatar
            ? Promise.resolve(null)
            : (0, ens_1.getEnsAvatar)(client, { name: normalizedDomainName, universalResolverAddress }),
        skipExpiry
            ? Promise.resolve(null)
            : getEnsExpiry(provider, {
                name: normalizedDomainName,
                addresses: {
                    baseRegistrar: options?.expiry?.baseRegistrar,
                    nameWrapper: options?.expiry?.nameWrapper
                }
            })
    ]);
    return {
        address: address || '',
        avatar,
        expiry
    };
}
/**
 * Batches the reverse lookup (address -> primary name) for many addresses into deployless.
 *
 * CCIP-read (EIP-3668) reverse records cannot be resolved inside a single `eth_call` (there is
 * no client-side gateway handling), so the contract flags them as `needsOffchainLookup` and we
 * fallback to viem's `getEnsName` for just those addresses.
 */
async function reverseLookupEns(addresses, provider, options) {
    if (!addresses.length)
        return {};
    const universalResolverAddress = options?.universalResolverAddress ?? exports.ENS_UNIVERSAL_RESOLVER;
    const result = {};
    const offchainLookupAddresses = [];
    const deploylessEnsGetter = (0, deployless_1.fromDescriptor)(provider, EnsGetter_json_1.default, true);
    const addressChunks = chunkArray(addresses, REVERSE_LOOKUP_CHUNK_SIZE);
    const chunkResults = await Promise.allSettled(addressChunks.map((addressChunk) => deploylessEnsGetter.call('getNames', [
        universalResolverAddress,
        addressChunk,
        ETHEREUM_COIN_TYPE,
        [LOCAL_BATCH_GATEWAY_URL]
    ])));
    addressChunks.forEach((addressChunk, chunkIndex) => {
        const chunkResult = chunkResults[chunkIndex];
        if (!chunkResult || chunkResult.status === 'rejected') {
            if (chunkResult?.status === 'rejected') {
                console.warn('batched reverse lookup chunk failed', chunkResult.reason);
            }
            addressChunk.forEach((address) => {
                result[address] = { name: null, failed: true };
            });
            return;
        }
        addressChunk.forEach((address, index) => {
            if (!chunkResult.value)
                return;
            const reverseResult = chunkResult.value[index];
            if (reverseResult?.needsOffchainLookup) {
                offchainLookupAddresses.push(address);
                return;
            }
            result[address] = {
                name: reverseResult?.hasName ? reverseResult.resolvedName || null : null,
                failed: false
            };
        });
    });
    if (offchainLookupAddresses.length) {
        const client = (0, provider_1.getViemClientForProvider)(provider);
        await Promise.all(offchainLookupAddresses.map(async (address) => {
            try {
                const name = await (0, ens_1.getEnsName)(client, {
                    address: address,
                    universalResolverAddress,
                    coinType: ETHEREUM_COIN_TYPE
                });
                result[address] = { name: name || null, failed: false };
            }
            catch (e) {
                console.warn('CCIP-read reverse lookup failed for address', address, e);
                result[address] = { name: null, failed: true };
            }
        }));
    }
    return result;
}
async function getEnsAvatar(name, provider, options) {
    const normalizedName = (0, ens_1.normalize)(name);
    if (!normalizedName)
        return null;
    const client = (0, provider_1.getViemClientForProvider)(provider);
    return (0, ens_1.getEnsAvatar)(client, {
        name: normalizedName,
        universalResolverAddress: options?.universalResolverAddress ?? exports.ENS_UNIVERSAL_RESOLVER
    });
}
// Clamp to the max MS a JS Date
const MAX_SAFE_MS = 8_640_000_000_000_000;
const toMs = (seconds) => {
    const ms = seconds * 1000n;
    return ms > BigInt(MAX_SAFE_MS) ? MAX_SAFE_MS : Number(ms);
};
const isDotEth2ld = (labels) => labels.length === 2 && labels[1] === 'eth';
/**
 * Returns the expiry of an ENS name.
 * Does two things depending on the name:
 *   - `.eth` 2LD (e.g. `name.eth`): read from the .eth BaseRegistrar, which gives the true
 *     registration expiry plus a separate GRACE_PERIOD. This holds whether or not the 2LD is wrapped.
 *   - everything else (subnames like `sub.name.eth`, wrapped DNS names like `name.com`): read from
 *     the NameWrapper via `getData`, which has no grace period, so `gracePeriodEndsAt === expiresAt`.
 */
async function getEnsExpiry(provider, { name, contract, addresses }) {
    const normalized = (0, ens_1.normalize)(name);
    const labels = normalized.split('.');
    const [firstLabel = ''] = labels;
    const useRegistrar = contract === 'registrar' || (contract === undefined && isDotEth2ld(labels));
    const baseRegistrar = addresses?.baseRegistrar ?? exports.ENS_BASE_REGISTRAR;
    const nameWrapper = addresses?.nameWrapper ?? exports.ENS_NAME_WRAPPER;
    // labelhash(first label) is the registrar token id; namehash(full name) is the wrapper node.
    const id = useRegistrar ? BigInt((0, viem_1.labelhash)(firstLabel)) : BigInt((0, viem_1.namehash)(normalized));
    const deploylessEnsGetter = (0, deployless_1.fromDescriptor)(provider, EnsGetter_json_1.default, true);
    const { expiry, gracePeriod, blockTimestamp } = (await deploylessEnsGetter.call('getExpiry', [
        useRegistrar,
        baseRegistrar,
        nameWrapper,
        id
    ]));
    if (expiry === 0n)
        return null;
    return {
        expiresAt: toMs(expiry),
        gracePeriodEndsAt: toMs(expiry + gracePeriod),
        updatedAt: toMs(blockTimestamp)
    };
}
//# sourceMappingURL=ensDomains.js.map