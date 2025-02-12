import { Account } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { ActiveRoute, SocketAPISendTransactionRequest, SocketAPIStep, SocketAPIToken, SocketAPIUserTx, SwapAndBridgeToToken } from '../../interfaces/swapAndBridge';
import { SignUserRequest } from '../../interfaces/userRequest';
import { TokenResult } from '../portfolio';
export declare const sortTokenListResponse: (tokenListResponse: SwapAndBridgeToToken[], accountPortfolioTokenList: TokenResult[]) => SwapAndBridgeToToken[];
export declare const sortPortfolioTokenList: (accountPortfolioTokenList: TokenResult[]) => TokenResult[];
/**
 * Determines if a token is eligible for swapping and bridging.
 * Not all tokens in the portfolio are eligible.
 */
export declare const getIsTokenEligibleForSwapAndBridge: (token: TokenResult) => boolean;
export declare const convertPortfolioTokenToSocketAPIToken: (portfolioToken: TokenResult, chainId: number) => SocketAPIToken;
declare const getQuoteRouteSteps: (userTxs: SocketAPIUserTx[]) => SocketAPIStep[];
declare const getActiveRoutesLowestServiceTime: (activeRoutes: ActiveRoute[]) => number;
declare const getActiveRoutesUpdateInterval: (minServiceTime?: number) => 5000 | 8000 | 15000 | 7000 | 6000 | 12000;
declare const buildSwapAndBridgeUserRequests: (userTx: SocketAPISendTransactionRequest, networkId: string, account: Account, provider: RPCProvider) => Promise<SignUserRequest[]>;
export declare const getIsBridgeTxn: (userTxType: SocketAPIUserTx['userTxType']) => boolean;
/**
 * Checks if a network is supported by our Swap & Bridge service provider. As of v4.43.0
 * there are 16 networks supported, so user could have (many) custom networks that are not.
 */
export declare const getIsNetworkSupported: (supportedChainIds: Network['chainId'][], network?: Network) => boolean;
declare const getActiveRoutesForAccount: (accountAddress: string, activeRoutes: ActiveRoute[]) => ActiveRoute[];
export { getQuoteRouteSteps, getActiveRoutesLowestServiceTime, getActiveRoutesUpdateInterval, buildSwapAndBridgeUserRequests, getActiveRoutesForAccount };
//# sourceMappingURL=swapAndBridge.d.ts.map