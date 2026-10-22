import { SwapAmountWarning } from '../../consts/safeguards/swapAmountWarnings';
import { Account, AccountOnchainState } from '../../interfaces/account';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { FromToken, SwapAndBridgeActiveRoute, SwapAndBridgeQuote, SwapAndBridgeRoute, SwapAndBridgeSendTxRequest, SwapAndBridgeToToken, SwapAndBridgeUserTx } from '../../interfaces/swapAndBridge';
import { CallsUserRequest } from '../../interfaces/userRequest';
import { SubmittedAccountOp } from '../accountOp/submittedAccountOp';
import { Call } from '../accountOp/types';
import { PaymasterService } from '../erc7677/types';
import { TokenResult } from '../portfolio';
declare const getBannedToTokenList: (chainId: string) => string[];
export declare const attemptToSortTokensByMarketCap: ({ fetch, chainId, tokens, featureFlags }: {
    fetch: Fetch;
    chainId: number;
    tokens: SwapAndBridgeToToken[];
    featureFlags: Pick<IFeatureFlagsController, "isFeatureEnabled">;
}) => Promise<SwapAndBridgeToToken[]>;
export declare const sortNativeTokenFirst: (tokens: SwapAndBridgeToToken[]) => SwapAndBridgeToToken[];
export declare const sortTokenListResponse: (tokenListResponse: SwapAndBridgeToToken[], accountPortfolioTokenList: TokenResult[]) => SwapAndBridgeToToken[];
export declare const sortPortfolioTokenList: (accountPortfolioTokenList: TokenResult[]) => TokenResult[];
/**
 * Determines if a token is eligible for swapping and bridging.
 * Not all tokens in the portfolio are eligible.
 */
export declare const getIsTokenEligibleForSwapAndBridge: (token: TokenResult, requirePositiveBalance?: boolean, requirePrice?: boolean) => boolean;
export declare const convertPortfolioTokenToSwapAndBridgeToToken: (portfolioToken: TokenResult, chainId: number) => SwapAndBridgeToToken;
/**
 * Return the lowest active route service time in MILLISECONDS
 */
declare const getActiveRoutesLowestServiceTime: (activeRoutes: SwapAndBridgeActiveRoute[]) => number;
declare const getActiveRoutesUpdateInterval: (minServiceTime?: number) => 60000 | 30000;
declare const getSwapAndBridgeCalls: (userTx: SwapAndBridgeSendTxRequest, account: Account, provider: RPCProvider, state: AccountOnchainState) => Promise<Call[]>;
declare const getSwapAndBridgeRequestParams: (userTx: SwapAndBridgeSendTxRequest, chainId: bigint, account: Account, provider: RPCProvider, state: AccountOnchainState, paymasterService?: PaymasterService, quote?: SwapAndBridgeQuote) => Promise<{
    calls: CallsUserRequest["signAccountOp"]["accountOp"]["calls"];
    meta: CallsUserRequest["meta"];
}>;
export declare const getIsBridgeRoute: (route: SwapAndBridgeRoute) => boolean;
/** Returns whether the route completes asynchronously after the user's transaction. */
export declare const getIsIntentRoute: (route: SwapAndBridgeRoute) => boolean;
/**
 * Checks if a network is supported by our Swap & Bridge service provider. As of v4.43.0
 * there are 16 networks supported, so user could have (many) custom networks that are not.
 */
export declare const getIsNetworkSupported: (supportedChainIds: Network["chainId"][], network?: Network) => boolean;
declare const getActiveRoutesForAccount: (accountAddress: string, activeRoutes: SwapAndBridgeActiveRoute[]) => SwapAndBridgeActiveRoute[];
/**
 * Since v4.41.0 we request the shortlist from our service provider, which might
 * not include the Ambire $WALLET token. So adding it manually on the supported chains.
 */
declare const addCustomTokensIfNeeded: ({ tokens, chainId }: {
    tokens: SwapAndBridgeToToken[];
    chainId: number;
}) => SwapAndBridgeToToken[];
declare const lifiMapNativeToAddr: (chainId: number, tokenAddr: string) => string;
/**
 * Map the token address back to native when needed
 */
declare const mapBannedToValidAddr: (chainId: number, tokenAddr: string) => string;
declare const isNoFeeToken: (chainId: number, tokenAddr: string) => boolean;
declare const getSlippage: (fromAsset: TokenResult, fromAmount: bigint, upperBoundary: string, delimeter: number) => string;
export declare const calculateAmountWarnings: (selectedRoute: SwapAndBridgeQuote["selectedRoute"], fromAmountInFiat: string, fromAmount: string, fromSelectedTokenDecimals: number) => SwapAmountWarning | null;
declare const getLink: (route: SwapAndBridgeActiveRoute) => string;
declare const isTxnBridge: (txn: SwapAndBridgeUserTx) => boolean;
declare const convertNullAddressToZeroAddressIfNeeded: (addr: string) => string;
/**
 * Get the swap sponsorship details.
 * We need the native price so we can later understand if the cost
 * of the txn in USD is less than the swap fee to sponsor it.
 * No sponsorships in og mode.
 * Also, to calculate the fee in USD, we multiply the full from
 * amount in USD to the fee percent
 */
declare const getSwapSponsorship: ({ isErc4337Enabled, hasConvinienceFee, nativePrice, fromAmountInUsd, feeTokenPriceInUsd, feeTokenDecimals, providerId, isIntent, feePercent }: {
    isErc4337Enabled: boolean;
    hasConvinienceFee: boolean;
    nativePrice: number | undefined;
    fromAmountInUsd: number | undefined;
    feeTokenPriceInUsd: number | undefined;
    feeTokenDecimals: number | undefined;
    providerId: string | undefined;
    isIntent: boolean;
    feePercent: number;
}) => {
    nativePrice: number;
    swapFeeInUsd: number;
    feeTokenPriceInUsd: number;
    feeTokenDecimals: number;
} | undefined;
declare const getFeeTokenForSponsorship: (fromSelectedToken: FromToken, quote?: SwapAndBridgeQuote | null, fromAmount?: string) => {
    feeTokenPriceInUsd: number | undefined;
    decimals: number | undefined;
};
/**
 * Calculates route output values for sorting with a shared output-token price,
 * without changing the provider values displayed in the UI.
 */
declare const getRouteOutputValuesForSorting: (route: SwapAndBridgeRoute, outputTokenPriceUSD?: number | null) => {
    outputValueInUsd: number;
    outputValueAfterGasInUsd: number;
};
/**
 * Adds the Cena output-token price required by the warning calculations when the provider
 * doesn't supply one, without changing the provider USD values displayed in the UI.
 */
declare const enrichRouteWithOutputTokenPrice: (route: SwapAndBridgeRoute, outputTokenPriceUSD?: number | null) => SwapAndBridgeRoute;
/**
 * Turns the txns of a swap that went out before the rest of it failed (e.g. the approval
 * was sent but the swap was rejected on the hardware wallet) into an activity record.
 * - Only the sent calls are kept, so e.g. speeding it up doesn't include the unsent swap.
 * - It's detached from the swap route, as the user can retry the same route while it's
 *   still pending. The route is matched to account ops by their call ids and
 *   `meta.swapTxn.activeRouteId`, so e.g. the approval failing later would fail the retry.
 */
declare const getSentPartOfSwap: (sentAccountOp: SubmittedAccountOp) => SubmittedAccountOp;
export { addCustomTokensIfNeeded, convertNullAddressToZeroAddressIfNeeded, enrichRouteWithOutputTokenPrice, getActiveRoutesForAccount, getActiveRoutesLowestServiceTime, getActiveRoutesUpdateInterval, getBannedToTokenList, getFeeTokenForSponsorship, getLink, getRouteOutputValuesForSorting, getSentPartOfSwap, getSlippage, getSwapAndBridgeCalls, getSwapAndBridgeRequestParams, getSwapSponsorship, isNoFeeToken, isTxnBridge, lifiMapNativeToAddr, mapBannedToValidAddr };
//# sourceMappingURL=swapAndBridge.d.ts.map