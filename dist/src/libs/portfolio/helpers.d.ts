import { Account, AccountId } from '../../interfaces/account';
import { Network, NetworkId } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { CustomToken, TokenPreference } from './customToken';
import { AccountState, AdditionalPortfolioNetworkResult, NetworkState, PortfolioGasTankResult, PreviousHintsStorage, StrippedExternalHintsAPIResponse, TokenResult } from './interfaces';
export declare function overrideSymbol(address: string, networkId: string, symbol: string): string;
export declare function getFlags(networkData: any, networkId: NetworkId, tokenNetwork: NetworkId, address: string): {
    onGasTank: boolean;
    rewardsType: string | null;
    canTopUpGasTank: boolean | undefined;
    isFeeToken: boolean;
};
export declare const validateERC20Token: (token: {
    address: string;
    networkId: NetworkId;
}, accountId: string, provider: RPCProvider) => Promise<(string | boolean)[]>;
export declare const shouldGetAdditionalPortfolio: (account: Account) => boolean;
export declare const getTokenAmount: (token: TokenResult) => bigint;
export declare const getTokenBalanceInUSD: (token: TokenResult) => number;
export declare const getTotal: (t: TokenResult[], excludeHiddenTokens?: boolean) => {
    [key: string]: number;
};
export declare const addHiddenTokenValueToTotal: (totalWithoutHiddenTokens: number, tokens: TokenResult[]) => number;
export declare const getAccountPortfolioTotal: (accountPortfolio: AccountState, excludeNetworks?: Network['id'][], excludeHiddenTokens?: boolean) => number;
export declare const getPinnedGasTankTokens: (availableGasTankAssets: TokenResult[], hasNonZeroTokens: boolean, accountId: AccountId, gasTankTokens: TokenResult[]) => TokenResult[];
export declare const stripExternalHintsAPIResponse: (response: StrippedExternalHintsAPIResponse | null) => StrippedExternalHintsAPIResponse | null;
/**
 * Tasks:
 * - updates the external hints for [network:account] with the latest from the external API
 * - cleans the learned tokens by removing non-ERC20 items
 * - updates the timestamp of learned tokens
 * - returns the updated hints
 */
export declare function getUpdatedHints(latestHintsFromExternalAPI: StrippedExternalHintsAPIResponse | null, tokens: TokenResult[], tokenErrors: AdditionalPortfolioNetworkResult['tokenErrors'], networkId: NetworkId, storagePreviousHints: PreviousHintsStorage, key: string, customTokens: CustomToken[], tokenPreferences: TokenPreference[]): PreviousHintsStorage;
export declare const getTokensReadyToLearn: (toBeLearnedTokens: string[], resultTokens: TokenResult[]) => string[];
export declare const tokenFilter: (token: TokenResult, nativeToken: TokenResult, network: Network, hasNonZeroTokens: boolean, additionalHints: string[] | undefined, isTokenPreference: boolean) => boolean;
/**
 * Filter the TokenResult[] by certain criteria (please refer to `tokenFilter` for more details)
 * and set the token.flags.isHidden flag.
 */
export declare const processTokens: (tokenResults: TokenResult[], network: Network, hasNonZeroTokens: boolean, additionalHints: string[] | undefined, tokenPreferences: TokenPreference[], customTokens: CustomToken[]) => TokenResult[];
export declare const isPortfolioGasTankResult: (result: NetworkState['result']) => result is PortfolioGasTankResult;
export declare const isCurrentCashbackZero: (resBalance: any[]) => boolean;
//# sourceMappingURL=helpers.d.ts.map