import { ProviderQuoteParams, SwapAndBridgeQuote, SwapAndBridgeRoute, SwapAndBridgeRouteStatusResult, SwapAndBridgeSendTxRequest, SwapAndBridgeSupportedChain, SwapAndBridgeToToken, SwapProvider } from '../../interfaces/swapAndBridge';
export declare class SwapProviderParallelExecutor {
    #private;
    id: string;
    name: string;
    isHealthy: boolean | null;
    supportedChains: SwapProvider['supportedChains'];
    constructor(providers: SwapProvider[]);
    /**
     * In the dual setup, we're not using the health feature as
     * we're hoping that at least one provider is going to work at all times
     */
    updateHealth(): void;
    resetHealth(): void;
    getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]>;
    getToTokenList({ fromChainId, toChainId }: {
        fromChainId: number;
        toChainId: number;
    }): Promise<SwapAndBridgeToToken[]>;
    getToken({ address, chainId }: {
        address: string;
        chainId: number;
    }): Promise<SwapAndBridgeToToken | null>;
    startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest>;
    quote({ fromAsset, fromChainId, fromTokenAddress, toAsset, toChainId, toTokenAddress, fromAmount, userAddress, sort, accountNativeBalance, nativeSymbol, isWrapOrUnwrap }: ProviderQuoteParams): Promise<SwapAndBridgeQuote>;
    getRouteStatus({ txHash, fromChainId, toChainId, bridge, providerId, requestId, routeId }: {
        txHash: string;
        fromChainId: number;
        toChainId: number;
        bridge?: string;
        providerId: string;
        requestId?: string;
        routeId?: string;
    }): Promise<SwapAndBridgeRouteStatusResult>;
}
//# sourceMappingURL=swapProviderParallelExecutor.d.ts.map