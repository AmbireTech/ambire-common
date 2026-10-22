import { Price } from '../../interfaces/assets';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { CustomToken, TokenPreference } from './customToken';
import { AccountState, AssetMetadataFetchPlan, AssetValidationReason, ERC721s, ExtendedErrorWithLevel, ExternalAPITokenMarketDataResponse, ExternalHintsAPIResponse, FormattedExternalHintsAPIResponse, GetOptions, NetworkState, PortfolioGasTankResult, PortfolioNetworkResult, ToBeLearnedAssets, TokenDataCacheValue, TokenResult, TokenValidationResult, Total } from './interfaces';
export declare function overrideSymbol(address: string, chainId: bigint, symbol: string): string;
export declare function mergeERC721s(sources: ERC721s[]): ERC721s;
/**
 * Validates whether a token address represents a valid ERC20 token on the specified network.
 * Optionally suggests alternative networks where the token is found if validation fails.
 *
 */
export declare const validateERC20Token: (token: {
    address: string;
    chainId: bigint;
}, accountId: string, provider: RPCProvider, options?: {
    allNetworks?: Network[];
    allProviders?: {
        [chainId: string]: RPCProvider;
    };
    enableNetworkDetection?: boolean;
    maxNetworksToCheck?: number;
    concurrencyLimit?: number;
}) => Promise<TokenValidationResult>;
/**
 * Merges every source of ERC-721 hints for a network.
 *
 * The custom and the hidden collections are requested like any other, as the
 * account may hold a collectible no other source knows about, and a hidden
 * collection still has to be read to be listed as hidden. Their ids are added to
 * what the other sources found.
 *
 * An entry without ids asks for the whole collection, which would override the
 * exact ids of the other sources, so it is only used for a collection no other
 * source named ids for.
 */
export declare const mergeCollectionHints: ({ additionalHints, apiHints, specialHints }: {
    additionalHints?: ERC721s;
    apiHints: ERC721s;
    specialHints?: GetOptions["specialErc721Hints"];
}) => ERC721s;
/**
 * The collectibles of a collection that the account should see.
 *
 * A collection added by the user shows only the collectibles they added, so the
 * rest of it doesn't come along with them. Collections added before the ids
 * were recorded have none, which means the whole collection.
 *
 * `isDiscovered` marks a collection another source already found. Narrowing one
 * of those down to the added ids would hide collectibles the account was already
 * seeing, so only a collection that exists because it was added is narrowed.
 */
export declare const getVisibleCollectibles: ({ collectibles, customIds, hiddenIds, isDiscovered }: {
    collectibles: bigint[];
    customIds?: bigint[];
    hiddenIds?: bigint[];
    isDiscovered?: boolean;
}) => bigint[];
/**
 * Addresses reach the validation caches from user input, from dApps and from the
 * portfolio, so they are normalized to always resolve to the same entry.
 */
export declare const normalizeAssetAddress: (address: string) => string;
/** Key of a token or a collection in the validation cache */
export declare const getAssetCacheKey: (address: string, chainId: bigint) => string;
/** Key of a single collectible in the validation cache */
export declare const getCollectibleCacheKey: (address: string, chainId: bigint, tokenId: bigint) => string;
/**
 * Decides whether a contract is a collection, based on what it exposes.
 * Extracted so the decision can be tested without a provider.
 */
export declare const getErc721Validity: ({ supportsERC721, supportsERC1155, isContract, hasDecimals }: {
    supportsERC721?: boolean;
    supportsERC1155?: boolean;
    isContract: boolean;
    hasDecimals: boolean;
}) => {
    isValid: boolean;
    reason: AssetValidationReason | null;
};
/**
 * Checks whether the account owns the collectible. Used when a collection can't
 * be listed and the user names one of their collectibles explicitly.
 */
export declare const validateCollectibleOwnership: (collectible: {
    address: string;
    tokenId: bigint;
}, accountId: string, provider: RPCProvider) => Promise<TokenValidationResult>;
/** An ERC-20 token is rejected too, as it also exposes name() and balanceOf() */
export declare const validateERC721Token: (collection: {
    address: string;
    chainId: bigint;
}, provider: RPCProvider) => Promise<TokenValidationResult>;
export declare const getTokenAmount: (token: TokenResult, beforeSimulation?: boolean) => bigint;
export declare const getTokenUsdPrice: (token: TokenResult) => number;
/**
 * The token's balance in USD. Called once per token on every portfolio update and
 * once per token per comparison wherever a token list is sorted by it, so the
 * amount is converted with plain number math: `formatUnits` builds a decimal
 * string, which costs ~80us per call on a mid-range phone and dominated the
 * sorting of a large portfolio. A float carries the same precision the caller
 * ends up with either way, since the result is a float in both cases.
 */
export declare const getTokenBalanceInUSD: (token: TokenResult) => number;
/**
 * Tokens ordered by their USD balance, highest first. Each token's balance is
 * calculated once instead of on every comparison, which is what a comparator
 * that derives it would do (~20 times per token for a 1000-token portfolio).
 */
export declare const sortTokensByBalanceInUSD: <T extends TokenResult>(tokens: T[]) => T[];
export declare const getTotal: (t: TokenResult[], defiState: PortfolioNetworkResult["defiPositions"] | null, opts?: {
    includeHiddenTokens?: boolean;
    beforeSimulation?: boolean;
}) => Total;
export declare const addHiddenTokenValueToTotal: (totalWithoutHiddenTokens: number, tokens: TokenResult[]) => number;
export declare const getAccountPortfolioTotal: (accountPortfolio: AccountState | undefined, excludeNetworks?: string[], excludeHiddenTokens?: boolean) => number;
/**
 * Formats and strips the original velcro response
 */
export declare const formatExternalHintsAPIResponse: (response: Omit<ExternalHintsAPIResponse, "prices"> | null) => FormattedExternalHintsAPIResponse | null;
export declare const getSpecialHints: (chainId: Network["chainId"], customTokens: CustomToken[], tokenPreferences: TokenPreference[], toBeLearnedAssets: ToBeLearnedAssets) => {
    specialErc20Hints: {
        custom: string[];
        hidden: string[];
        learn: string[];
    };
    specialErc721Hints: {
        custom: {
            [collectionAddr: string]: bigint[];
        };
        hidden: {
            [collectionAddr: string]: bigint[];
        };
        learn: {
            [collectionAddr: string]: bigint[];
        };
    };
};
/**
 * Converts ERC721 hints to keys that can be used for:
 * - comparison of NFTs
 * - storage
 */
export declare const erc721CollectionToLearnedAssetKeys: (collection: [string, bigint[]]) => string[];
/**
 * Converts `LearnedAssets` ERC721 hint keys to
 * `ERC721` hints. For more info, see `LearnedAssets`
 */
export declare const learnedErc721sToHints: (keys: string[]) => ERC721s;
export declare const tokenFilter: (token: TokenResult, network: Network, isToBeLearned: boolean, shouldIncludePinned: boolean, nativeToken?: TokenResult) => boolean;
export declare const isPortfolioGasTankResult: (result: NetworkState["result"]) => result is PortfolioGasTankResult;
export declare const isNative: (token: TokenResult) => boolean;
export declare const getHintsError: (errorMessage: string, lastExternalApiHintsData: {
    lastUpdate: number;
    hasHints: boolean;
} | null) => ExtendedErrorWithLevel;
export declare const getHardcodedCitreaPrices: (address: string) => Price | null;
/**
 * The API may return the token checksummed or lowercase so we normalize it to lowercase to avoid cache misses.
 */
export declare const getTokenDataCacheKey: (address: string) => string;
export declare const convertApiTokenDataToTokenDataCache: (tokenData: ExternalAPITokenMarketDataResponse | null) => TokenDataCacheValue;
/**
 * How long stored token metadata is trusted before it is read from the chain again.
 * Symbols and names do change on rare occasions, such as a token rebrand behind an
 * upgradeable proxy.
 */
export declare const TOKEN_METADATA_MAX_AGE_MS: number;
/**
 * Whether the chain has to be asked for an asset's metadata (a token's symbol, name
 * and decimals, or a collection's name and symbol). True when nothing is stored for
 * it, or when what is stored has aged out.
 */
export declare function isAssetMetadataStale(entry: {
    fetchedAt: number;
} | undefined, now: number): boolean;
/**
 * Splits the passed addresses into the metadata already held for them and the ones
 * whose metadata has to be read on this update. The map is copied, so that an update in
 * flight keeps the metadata it started with even if the caller's store drops entries in
 * the meantime.
 */
export declare function planAssetMetadata<T extends {
    fetchedAt: number;
}>(addresses: string[], known: Map<string, T> | undefined, now: number): AssetMetadataFetchPlan<T>;
//# sourceMappingURL=helpers.d.ts.map