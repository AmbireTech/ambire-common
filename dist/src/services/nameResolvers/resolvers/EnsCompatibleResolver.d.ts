import { Address } from 'viem';
import { FeatureFlags } from '../../../consts/featureFlags';
import { NameExpiry, ReverseLookupResult } from '../../ensDomains/ensDomains';
import { ForwardResolution, ForwardResolutionOptions, NameResolver, NameServiceId, NetworkMode, ResolveContext } from '../types';
export declare const ETHEREUM_CHAIN_ID: {
    mainnet: string;
    testnet: string;
};
export type EnsCompatibleConfig = {
    id: NameServiceId;
    label: string;
    universalResolver: Address;
    chainId: {
        mainnet: string;
        testnet: string;
    };
    featureFlag?: keyof FeatureFlags;
    isFallback?: boolean;
    /** Present when the service has an ENS registrar/NameWrapper, which is what makes it expirable. */
    expiry?: {
        baseRegistrar: string;
        nameWrapper: {
            mainnet: string;
            testnet: string;
        };
    };
};
/**
 * Shared implementation for ENS and ENS-compatible services: same universal-resolver interface, a
 * different contract address and, optionally, a different chain.
 */
export declare abstract class EnsCompatibleResolver implements NameResolver {
    readonly id: NameServiceId;
    readonly label: string;
    readonly featureFlag?: keyof FeatureFlags;
    readonly isFallback: boolean;
    readonly capabilities: {
        reverse: boolean;
        avatar: boolean;
        expiry: boolean;
    };
    protected readonly universalResolver: Address;
    protected readonly chainId: {
        mainnet: string;
        testnet: string;
    };
    protected readonly expiryConfig?: EnsCompatibleConfig['expiry'];
    constructor(config: EnsCompatibleConfig);
    abstract matches(domain: string): boolean;
    /**
     * ENS-compatible services share ENSIP-15 (UTS-46) normalization.
     */
    normalize(domain: string): string | null;
    requiredChainId(networkMode: NetworkMode): string | undefined;
    protected providerFor(ctx: ResolveContext): import("../../../interfaces/provider").RPCProvider;
    resolve(domain: string, ctx: ResolveContext, options?: ForwardResolutionOptions): Promise<ForwardResolution | null>;
    reverse(addresses: string[], ctx: ResolveContext): Promise<ReverseLookupResult>;
    getAvatar(name: string, ctx: ResolveContext): Promise<string | null>;
    getExpiry(name: string, ctx: ResolveContext): Promise<NameExpiry | null>;
    shouldRefetchExpiry(_name: string, cachedExpiry: NameExpiry | null | undefined): boolean;
}
//# sourceMappingURL=EnsCompatibleResolver.d.ts.map