import type { TokenBlacklist } from './interfaces';
/**
 * Static list of tokens to exclude from display, keyed by chainId.
 * Addresses MUST BE CHECKSUMMED.
 * Symbol patterns are matched case-insensitively as substrings.
 */
export declare const STATIC_BLACKLIST: Omit<TokenBlacklist, 'updatedAt'>;
export declare const filterStaticBlacklistedAddrs: (tokenAddrs: string[], chainId: bigint) => string[];
/**
 * Detects a real registrable domain anywhere in the text (e.g. "uniswap.org",
 * "claim-x.xyz"). Spam assets embed phishing domains in their name/symbol to
 * impersonate real projects, often without an "https"/"www." prefix.
 *
 * We scan the text into domain-charset candidates (no regex, per repo rule) and
 * validate each against the Public Suffix List via tldts. The `isIcann` check
 * rejects non-domain dotted strings such as "v2.0" or "eth.staking".
 */
export declare const containsDomainLike: (text: string) => boolean;
export interface PreparedBlacklistPatterns {
    wordPatterns: string[];
    substringPatterns: string[];
}
/**
 * Normalizes raw blacklist patterns once, so per-asset matching stays cheap.
 *
 * Classification keys off the surrounding whitespace the backend already uses:
 * - a SPACE-PADDED single word (" mint", "mint ", " mint ") is a lure word. The
 *   padding was a one-sided word-boundary hack that misfired on words like
 *   "papermint", so we strip it and match it as a whole word instead (see
 *   `toWords`). Padded duplicates collapse to one entry, so the backend can also
 *   send a single padded variant per word.
 * - everything else — a BARE pattern ("https", "www.", a full symbol/name) or a
 *   padded multi-word phrase — keeps the case-insensitive SUBSTRING contract and
 *   matches anywhere.
 */
export declare const prepareBlacklistPatterns: (rawPatterns: string[]) => PreparedBlacklistPatterns;
/**
 * Decides whether an asset (ERC-20 token or NFT collection) should be hidden as
 * spam based on its symbol and name. Custom (user-added) assets are never hidden.
 *
 * Spam often hides the lure in the name rather than the symbol, so both are
 * checked, combining the prepared blacklist patterns (see
 * `prepareBlacklistPatterns`) with a domain-like detector (see
 * `containsDomainLike`):
 * - word patterns ("airdrop", "claim") match only on word boundaries, so
 *   "free mint" is hidden but "papermint protocol" is not
 * - substring patterns ("www.", "t.me") match anywhere
 *
 * The symbol and name are matched SEPARATELY and never joined into one string,
 * so a token with symbol "WIN" plus a name does not gain an artificial boundary.
 *
 * Word patterns only fire inside MULTI-WORD text. A single-token symbol or name
 * — "WIN", "WETH", even "WIN-AIRDROP" — is left visible, because a legitimate
 * ticker often collides with a lure word; the spam we target reads as a phrase
 * ("claim your airdrop now"), where the lure sits among other words. Substring
 * patterns ("www.", "https") ignore this gate and still match a single token.
 */
export declare const isBlacklistedAsset: ({ symbol, name, isCustom, patterns, checkForEmbeddedDomain }: {
    symbol: string;
    name?: string;
    isCustom?: boolean;
    patterns: PreparedBlacklistPatterns;
    checkForEmbeddedDomain?: boolean;
}) => boolean;
//# sourceMappingURL=blacklist.d.ts.map