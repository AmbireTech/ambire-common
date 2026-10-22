import { ProviderQuoteParams, SwapAndBridgeQuote, SwapAndBridgeRoute, SwapAndBridgeRouteStatusResult, SwapAndBridgeSendTxRequest, SwapAndBridgeSupportedChain, SwapAndBridgeToToken, SwapProvider, SwapProviderExecutor, SwapProviderInfo } from '../../interfaces/swapAndBridge';
export declare class SwapProviderParallelExecutor implements SwapProviderExecutor {
    #private;
    id: string;
    name: string;
    isHealthy: boolean | null;
    supportedChains: SwapProvider['supportedChains'];
    constructor(providers: SwapProvider[], getFallbackSupportedChains?: () => SwapAndBridgeSupportedChain[], getDisabledProviders?: () => string[]);
    /** Returns serializable metadata without exposing the private provider instances. */
    getProvidersInfo(): SwapProviderInfo[];
    /**
     * In the dual setup, we're not using the health feature as
     * we're hoping that at least one provider is going to work at all times
     */
    updateHealth(): void;
    resetHealth(): void;
    getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]>;
    getToTokenList({ fromChainId, toChainId, onUpdate }: {
        fromChainId: number;
        toChainId: number;
        onUpdate?: (tokens: SwapAndBridgeToToken[], loadingProviderNames: string[]) => void;
    }): Promise<SwapAndBridgeToToken[]>;
    getToken({ address, chainId }: {
        address: string;
        chainId: number;
    }): Promise<SwapAndBridgeToToken | null>;
    startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest>;
    quote({ fromAsset, fromChainId, fromTokenAddress, toAsset, toChainId, toTokenAddress, fromAmount, userAddress, sort, accountNativeBalance, nativeSymbol, isWrapOrUnwrap, feePercent }: ProviderQuoteParams): Promise<SwapAndBridgeQuote>;
    getRouteStatus({ txHash, fromChainId, toChainId, bridge, providerId, requestId, routeId, rawRoute }: {
        txHash: string;
        fromChainId: number;
        toChainId: number;
        bridge?: string;
        providerId: string;
        requestId?: string;
        routeId?: string;
        rawRoute?: SwapAndBridgeRoute['rawRoute'];
    }): Promise<SwapAndBridgeRouteStatusResult>;
}
//# sourceMappingURL=swapProviderParallelExecutor.d.ts.map