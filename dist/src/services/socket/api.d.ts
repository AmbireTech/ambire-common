import { Fetch } from '../../interfaces/fetch';
import { ProviderQuoteParams, SocketAPIToken, SwapAndBridgeQuote, SwapAndBridgeRoute, SwapAndBridgeRouteStatusResult, SwapAndBridgeSendTxRequest, SwapAndBridgeSupportedChain, SwapAndBridgeToToken, SwapProvider } from '../../interfaces/swapAndBridge';
export declare const normalizeIncomingSocketToken: (token: SocketAPIToken) => {
    address: string;
    chainId: number;
    decimals: number;
    icon: string;
    logoURI: string;
    name: string;
    symbol: string;
};
export declare class SocketAPI implements SwapProvider {
    #private;
    id: string;
    name: string;
    isHealthy: boolean | null;
    supportedChains: SwapProvider['supportedChains'];
    constructor({ fetch, apiKey }: {
        fetch: Fetch;
        apiKey: string;
    });
    getHealth(): Promise<boolean>;
    updateHealth(): Promise<void>;
    updateHealthIfNeeded(): Promise<void>;
    resetHealth(): void;
    /** disable explicitly citrea for socket */
    areChainsSupported({ fromChainId, toChainId }: {
        fromChainId: number;
        toChainId: number;
    }): boolean;
    getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]>;
    getToTokenList({ toChainId }: {
        toChainId: number;
    }): Promise<SwapAndBridgeToToken[]>;
    getToken({ address, chainId }: {
        address: string;
        chainId: number;
    }): Promise<SwapAndBridgeToToken | null>;
    quote({ fromAsset, toAsset, fromChainId, fromTokenAddress, toChainId, toTokenAddress, fromAmount, userAddress, isWrapOrUnwrap, accountNativeBalance, nativeSymbol }: ProviderQuoteParams): Promise<SwapAndBridgeQuote>;
    startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest>;
    getRouteStatus({ txHash }: {
        txHash: string;
    }): Promise<SwapAndBridgeRouteStatusResult>;
}
//# sourceMappingURL=api.d.ts.map