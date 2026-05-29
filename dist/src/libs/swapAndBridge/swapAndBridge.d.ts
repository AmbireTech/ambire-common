import { Account, AccountOnchainState } from '../../interfaces/account';
import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { SwapAndBridgeActiveRoute, SwapAndBridgeQuote, SwapAndBridgeRoute, SwapAndBridgeSendTxRequest, SwapAndBridgeToToken, SwapAndBridgeUserTx } from '../../interfaces/swapAndBridge';
import { CallsUserRequest } from '../../interfaces/userRequest';
import { Call } from '../accountOp/types';
import { PaymasterService } from '../erc7677/types';
import { TokenResult } from '../portfolio';
declare const getBannedToTokenList: (chainId: string) => string[];
export declare const attemptToSortTokensByMarketCap: ({ fetch, chainId, tokens }: {
    fetch: Fetch;
    chainId: number;
    tokens: SwapAndBridgeToToken[];
}) => Promise<SwapAndBridgeToToken[]>;
export declare const sortNativeTokenFirst: (tokens: SwapAndBridgeToToken[]) => SwapAndBridgeToToken[];
export declare const sortTokenListResponse: (tokenListResponse: SwapAndBridgeToToken[], accountPortfolioTokenList: TokenResult[]) => SwapAndBridgeToToken[];
export declare const sortPortfolioTokenList: (accountPortfolioTokenList: TokenResult[]) => TokenResult[];
/**
 * Determines if a token is eligible for swapping and bridging.
 * Not all tokens in the portfolio are eligible.
 */
export declare const getIsTokenEligibleForSwapAndBridge: (token: TokenResult, requirePositiveBalance?: boolean) => boolean;
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
export declare const calculateAmountWarnings: (selectedRoute: SwapAndBridgeQuote["selectedRoute"], fromAmountInFiat: string, fromAmount: string, fromSelectedTokenDecimals: number) => {
    type: "highPriceImpact";
    percentageDiff: number;
} | {
    type: "slippageImpact";
    possibleSlippage: number;
    minInUsd: number;
    minInToken: string;
    symbol: string;
} | null;
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
declare const getSwapSponsorship: ({ hasConvinienceFee, nativePrice, fromAmountInUsd, fromTokenPriceInUsd, fromTokenDecimals, providerId }: {
    hasConvinienceFee: boolean;
    nativePrice: number | undefined;
    fromAmountInUsd: number | undefined;
    fromTokenPriceInUsd: number | undefined;
    fromTokenDecimals: number | undefined;
    providerId: string | undefined;
}) => {
    nativePrice: number;
    swapFeeInUsd: number;
    fromTokenPriceInUsd: number;
    fromTokenDecimals: number;
} | undefined;
export { addCustomTokensIfNeeded, convertNullAddressToZeroAddressIfNeeded, getActiveRoutesForAccount, getActiveRoutesLowestServiceTime, getActiveRoutesUpdateInterval, getBannedToTokenList, getLink, getSlippage, getSwapAndBridgeCalls, getSwapAndBridgeRequestParams, getSwapSponsorship, isNoFeeToken, isTxnBridge, lifiMapNativeToAddr, mapBannedToValidAddr };
//# sourceMappingURL=swapAndBridge.d.ts.map