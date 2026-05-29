import { RPCProvider } from '@/interfaces/provider';
export declare const NAMOSHI_UNIVERSAL_RESOLVER = "0xc5Ed1fA34AD1F23F0cD2E36DB288290488B1B493";
export declare function getIsNamoshiDomain(domain: string): boolean;
export declare function isCorrectAddress(address: string): boolean;
/**
 * Resolves an ENS/Namoshi domain to an address and avatar.
 *
 * Can work with a custom universal resolver if the domain is a Namoshi domain, otherwise it defaults to the ENS universal resolver.
 */
declare function resolveENSDomain({ provider, domain, options }: {
    provider: RPCProvider;
    domain: string;
    options?: {
        universalResolverAddress?: string;
    };
}): Promise<{
    address: string;
    avatar: string | null;
}>;
declare function reverseLookupEns(address: string, provider: RPCProvider, options?: {
    universalResolverAddress?: string;
}): Promise<string>;
declare function getEnsAvatar(name: string, provider: RPCProvider, options?: {
    universalResolverAddress?: string;
}): Promise<string>;
export { resolveENSDomain, getEnsAvatar, reverseLookupEns };
//# sourceMappingURL=ensDomains.d.ts.map