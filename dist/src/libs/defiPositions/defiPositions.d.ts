import { AccountId } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { RPCProvider, RPCProviders } from '../../interfaces/provider';
import { TokenResult } from '../portfolio';
import { AccountState, FormattedPortfolioDiscoveryResponse, PortfolioNetworkResult } from '../portfolio/interfaces';
import { updatePositionsByProviderAssetPrices } from './defiPrices';
import { getAssetValue } from './helpers';
import { DeFiPositionsError, NetworkState, NetworksWithPositions, NetworksWithPositionsByAccounts, Position, PositionsByProvider, ProviderError } from './types';
export declare const getIsExternalApiDefiPositionsCallSuccessful: (discoveryResponse: FormattedPortfolioDiscoveryResponse | null) => boolean;
/**
 * Fetches the defi positions of certain protocols using RPC calls and custom logic.
 * Cena is used for most of the positions, but some protocols require additional data
 * that is not available in Cena. This function fetches those positions on ENABLED
 * networks only.
 *
 * Returns the old positions if the call fails. Some positions, like that of Uniswap V3,
 * are merged with the data from Cena/Debank.
 */
declare const getCustomProviderPositions: (addr: string, provider: RPCProvider, network: Network, fetch: Function, previousPositions: PositionsByProvider[], debankNetworkPositionsByProvider: PositionsByProvider[] | undefined, isDebankCallSuccessful: boolean) => Promise<{
    positionsByProvider: PositionsByProvider[];
    providerErrors: ProviderError[];
    error?: DeFiPositionsError | null;
}>;
/**
 * Merges Debank positions with custom fetched positions, ensuring uniqueness by provider.
 */
declare const getUniqueMergedPositions: (debankNetworkPositionsByProvider: PositionsByProvider[], customPositions: PositionsByProvider[], stkWalletPosition: PositionsByProvider | null) => PositionsByProvider[];
/**
 * Returns the addresses of all assets and their protocolAssets (if applicable) as an
 * array of addresses. These addresses can be used as hints by the portfolio controller.
 */
declare const getAllAssetsAsHints: (portfolioState: PortfolioNetworkResult["defiPositions"] | undefined) => string[];
/**
 * Calculates the new DeFi positions state based on the latest fetched data
 * from Debank and custom providers and the previous state.
 * It ensures that positions are unique, merged correctly and that if the
 * latest Debank call failed, the previous positions are retained.
 */
declare const getNewDefiState: (pastPortfolioState: PortfolioNetworkResult | undefined, discoveryResponse: FormattedPortfolioDiscoveryResponse | null, customPositionsByProvider: PositionsByProvider[], customPositionsError: DeFiPositionsError | null, customProvidersErrors: ProviderError[], stkWalletToken: TokenResult | null, nonceId: string | undefined) => NetworkState;
/**
 * Formats the response from Debank in a format that is expected by the extension.
 * Invalid positions are excluded from the formatted response.
 */
declare const getFormattedApiPositions: (result: Omit<PositionsByProvider, "source">[]) => {
    source: "debank";
    chainId: bigint;
    positions: Position[];
    type: "common" | "locked" | "lending" | "leveraged_farming" | "vesting" | "reward" | "options_seller" | "options_buyer" | "insurance_seller" | "insurance_buyer" | "perpetuals" | "nft_common" | "nft_lending" | "nft_fraction";
    positionInUSD?: number;
    providerName: import("./types").ProviderName;
    iconUrl: string;
    siteUrl: string;
}[];
/**
 * Enhances the portfolio tokens with Defi position data.
 * Examples:
 * - Marks tokens that are part of a DeFi position with the position ID.
 * - Sets the defiTokenType flag based on the asset type in the DeFi position.
 * - Adjusts token prices for borrowed assets.
 * - Adds missing tokens that are part of DeFi positions but not in the portfolio tokens. This is a very rare
 * case in which the token is not found by Cena/Debank but is part of a custom defi position. Because they are fetched
 * after the portfolio tokens we need to add them here. This is needed only the first time as subsequent requests receive
 * the tokens as hints. (See `getAllAssetsAsHints`)
 */
declare const enhancePortfolioTokensWithDefiPositions: (portfolioTokens: TokenResult[], defiPositionsState: PortfolioNetworkResult["defiPositions"] | undefined) => TokenResult[];
declare const getHasNonceChangedSinceLastUpdate: (previousState: PortfolioNetworkResult["defiPositions"] | undefined, nonceId: string | undefined) => boolean;
/**
 * Whether the portfolio defi positions data should be updated
 */
declare const getCanSkipUpdate: (previousState: PortfolioNetworkResult["defiPositions"] | undefined, hasNonceChangedSinceLastUpdate: boolean, maxDataAgeMs?: number) => boolean;
declare const getShouldBypassServerSideCache: (previousState: PortfolioNetworkResult["defiPositions"] | undefined, isManualUpdate: boolean, hasKeys: boolean, sessionIds: string[], hasNonceChangedSinceLastUpdate: boolean) => boolean;
/**
 * Returns the networks where the account has positions with certainty.
 * Certainty - there are no errors and the rpc is working.
 */
declare const getAccountNetworksWithPositions: (accountId: AccountId, accountState: AccountState, oldNetworksWithPositionsByAccounts: NetworksWithPositionsByAccounts, providers: RPCProviders) => NetworksWithPositions;
export { enhancePortfolioTokensWithDefiPositions, getAccountNetworksWithPositions, getAllAssetsAsHints, getAssetValue, getCanSkipUpdate, getCustomProviderPositions, getFormattedApiPositions, getHasNonceChangedSinceLastUpdate, getNewDefiState, getShouldBypassServerSideCache, getUniqueMergedPositions, updatePositionsByProviderAssetPrices };
//# sourceMappingURL=defiPositions.d.ts.map