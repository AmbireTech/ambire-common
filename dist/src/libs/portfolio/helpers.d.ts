import { Price } from '../../interfaces/assets';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { CustomToken, TokenPreference } from './customToken';
import { AccountState, ERC721s, ExtendedErrorWithLevel, ExternalAPITokenMarketDataResponse, ExternalHintsAPIResponse, FormattedExternalHintsAPIResponse, GetOptions, NetworkState, PortfolioGasTankResult, PortfolioNetworkResult, SuspectedType, ToBeLearnedAssets, TokenDataCacheValue, TokenResult, TokenValidationResult, Total } from './interfaces';
export declare function overrideSymbol(address: string, chainId: bigint, symbol: string): string;
export declare const isSuspectedRegardsKnownAddresses: (tokenAddr: string, tokenSymbol: string, chainId: bigint) => boolean;
export declare const isSuspectedToken: (address: string, symbol: string, chainId: bigint) => SuspectedType;
export declare function getFlags(networkData: any, chainId: string, tokenChainId: bigint, address: string, name: string, symbol: string, hasSimulationAmount?: boolean): TokenResult['flags'];
export declare function mergeERC721s(sources: ERC721s[]): ERC721s;
export declare const mapToken: (token: Pick<TokenResult, "amount" | "decimals" | "name" | "symbol">, network: Network, address: string, opts: Pick<GetOptions, "specialErc20Hints" | "blockTag">, hasSimulationAmount?: boolean, latestAmount?: bigint) => TokenResult;
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
export declare const getTokenAmount: (token: TokenResult, beforeSimulation?: boolean) => bigint;
export declare const getTokenBalanceInUSD: (token: TokenResult) => number;
export declare const getTotal: (t: TokenResult[], defiState: PortfolioNetworkResult["defiPositions"] | null, opts?: {
    includeHiddenTokens?: boolean;
    beforeSimulation?: boolean;
}) => Total;
export declare const addHiddenTokenValueToTotal: (totalWithoutHiddenTokens: number, tokens: TokenResult[]) => number;
export declare const getAccountPortfolioTotal: (accountPortfolio: AccountState, excludeNetworks?: string[], excludeHiddenTokens?: boolean) => number;
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
export declare const convertApiTokenDataToTokenDataCache: (tokenData: ExternalAPITokenMarketDataResponse | null) => TokenDataCacheValue;
//# sourceMappingURL=helpers.d.ts.map