import { Account, AccountOnchainState } from '../../interfaces/account';
import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { SocketAPIUserTx, SwapAndBridgeActiveRoute, SwapAndBridgeRoute, SwapAndBridgeSendTxRequest, SwapAndBridgeToToken } from '../../interfaces/swapAndBridge';
import { Call } from '../accountOp/types';
import { PaymasterService } from '../erc7677/types';
import { TokenResult } from '../portfolio';
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
export declare const getIsTokenEligibleForSwapAndBridge: (token: TokenResult) => boolean;
export declare const convertPortfolioTokenToSwapAndBridgeToToken: (portfolioToken: TokenResult, chainId: number) => SwapAndBridgeToToken;
declare const getActiveRoutesLowestServiceTime: (activeRoutes: SwapAndBridgeActiveRoute[]) => number;
declare const getActiveRoutesUpdateInterval: (minServiceTime?: number) => 30000 | 60000;
declare const getSwapAndBridgeCalls: (userTx: SwapAndBridgeSendTxRequest, account: Account, provider: RPCProvider, state: AccountOnchainState) => Promise<Call[]>;
declare const buildSwapAndBridgeUserRequests: (userTx: SwapAndBridgeSendTxRequest, chainId: bigint, account: Account, provider: RPCProvider, state: AccountOnchainState, paymasterService?: PaymasterService) => Promise<{
    id: string;
    action: {
        kind: "calls";
        calls: Call[];
    };
    meta: {
        isSignAction: true;
        chainId: bigint;
        accountAddr: string;
        activeRouteId: string;
        isSwapAndBridgeCall: boolean;
        paymasterService: PaymasterService | undefined;
    };
}[]>;
export declare const getIsBridgeTxn: (userTxType: SocketAPIUserTx["userTxType"]) => userTxType is "fund-movr";
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
export { addCustomTokensIfNeeded, buildSwapAndBridgeUserRequests, getActiveRoutesForAccount, getActiveRoutesLowestServiceTime, getActiveRoutesUpdateInterval, getSwapAndBridgeCalls };
//# sourceMappingURL=swapAndBridge.d.ts.map