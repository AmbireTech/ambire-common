import type { TokenBlacklist } from './interfaces';
/**
 * Static list of tokens to exclude from display, keyed by chainId.
 * Addresses MUST BE CHECKSUMMED.
 * Symbol patterns are matched case-insensitively as substrings.
 */
export declare const STATIC_BLACKLIST: Omit<TokenBlacklist, 'updatedAt'>;
export declare const filterStaticBlacklistedAddrs: (tokenAddrs: string[], chainId: bigint) => string[];
//# sourceMappingURL=blacklist.d.ts.map