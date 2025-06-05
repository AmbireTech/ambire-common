import { Network } from '../interfaces/network';
export declare function geckoIdMapper(address: string, network: Network): string | null;
/**
 * Maps specific token addresses to alternative addresses if they are missing on
 * CoinGecko (so that they are aliased to existing tokens).
 */
export declare function geckoTokenAddressMapper(address: string): string;
/**
 * Constructs the CoinGecko API URL for a given token address and network ID.
 * Handles special cases where the CoinGecko API handles differently certain
 * tokens like the native tokens.
 */
export declare function getCoinGeckoTokenApiUrl({ tokenAddr, geckoChainId, geckoNativeCoinId }: {
    tokenAddr: string;
    geckoChainId: string;
    geckoNativeCoinId: string;
}): string;
/** Constructs the CoinGecko URL for a given token slug. */
export declare const getCoinGeckoTokenUrl: (slug: string) => string;
//# sourceMappingURL=coingecko.d.ts.map