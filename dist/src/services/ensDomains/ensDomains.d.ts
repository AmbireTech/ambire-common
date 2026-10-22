import { Address } from 'viem';
import { RPCProvider } from '../../interfaces/provider';
export declare const ENS_UNIVERSAL_RESOLVER = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe";
export declare const ENS_EXPIRY_WARN_WINDOW_IN_MS: number;
export declare const ENS_BASE_REGISTRAR = "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85";
export declare const ENS_NAME_WRAPPER = "0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401";
export declare const ENS_NAME_WRAPPER_SEPOLIA = "0x0635513f179D50A207757E05759CbD106d7dFcE8";
export type NameExpiry = {
    /** Registration expiry, in ms. Renewal is due at this point. */
    expiresAt: number;
    /**
     * End of the grace period, in ms. The name can be sniped only after this.
     * If there isn't a grace window it matches `expiresAt`.
     *  */
    gracePeriodEndsAt: number;
    updatedAt: number;
};
export type ReverseLookupResult = {
    [address: string]: {
        name: string | null;
        failed: boolean;
    };
};
export declare function isCorrectAddress(address: string): boolean;
/**
 * Resolves an ENS(-compatible) domain to an address, avatar and, for services that have an ENS
 * registrar/NameWrapper, its registration expiry. The universal resolver to query defaults to the
 * ENS one; ENS-compatible services (Namoshi, GNS) pass their own.
 */
declare function resolveENSDomain({ provider, domain, options }: {
    provider: RPCProvider;
    domain: string;
    options?: {
        /** Whether to resolve the avatar record. Defaults to true. */
        resolveAvatar?: boolean;
        /** Universal resolver to query. Defaults to the ENS one. */
        universalResolverAddress?: Address;
        /**
         * Registrar/NameWrapper config for reading the registration expiry. Omit to use the ENS
         * defaults; pass `null` for services without an ENS registrar (they have no expiry to read).
         */
        expiry?: {
            baseRegistrar?: string;
            nameWrapper?: string;
        } | null;
    };
}): Promise<{
    address: string;
    avatar: string | null;
    expiry: NameExpiry | null;
}>;
/**
 * Batches the reverse lookup (address -> primary name) for many addresses into deployless.
 *
 * CCIP-read (EIP-3668) reverse records cannot be resolved inside a single `eth_call` (there is
 * no client-side gateway handling), so the contract flags them as `needsOffchainLookup` and we
 * fallback to viem's `getEnsName` for just those addresses.
 */
declare function reverseLookupEns(addresses: string[], provider: RPCProvider, options?: {
    universalResolverAddress?: Address;
}): Promise<ReverseLookupResult>;
declare function getEnsAvatar(name: string, provider: RPCProvider, options?: {
    universalResolverAddress?: Address;
}): Promise<string>;
export type GetEnsExpiryParams = {
    /** The name, e.g. `name.eth`, `sub.name.eth`, `name.com`. */
    name: string;
    /**
     * Force a specific source contract.
     * Omit to let the name shape decide (.eth 2LD -> registrar, else -> nameWrapper).
     */
    contract?: 'registrar' | 'nameWrapper';
    /** Override contract addresses (defaults are Ethereum mainnet). */
    addresses?: {
        baseRegistrar?: string;
        nameWrapper?: string;
    };
};
/**
 * Returns the expiry of an ENS name.
 * Does two things depending on the name:
 *   - `.eth` 2LD (e.g. `name.eth`): read from the .eth BaseRegistrar, which gives the true
 *     registration expiry plus a separate GRACE_PERIOD. This holds whether or not the 2LD is wrapped.
 *   - everything else (subnames like `sub.name.eth`, wrapped DNS names like `name.com`): read from
 *     the NameWrapper via `getData`, which has no grace period, so `gracePeriodEndsAt === expiresAt`.
 */
declare function getEnsExpiry(provider: RPCProvider, { name, contract, addresses }: GetEnsExpiryParams): Promise<NameExpiry | null>;
export { resolveENSDomain, getEnsAvatar, reverseLookupEns, getEnsExpiry };
//# sourceMappingURL=ensDomains.d.ts.map