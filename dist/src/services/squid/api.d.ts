import { Fetch } from '../../interfaces/fetch';
import { ProviderQuoteParams, SwapAndBridgeQuote, SwapAndBridgeRoute, SwapAndBridgeRouteStatusResult, SwapAndBridgeSendTxRequest, SwapAndBridgeSupportedChain, SwapAndBridgeToToken, SwapProvider } from '../../interfaces/swapAndBridge';
export declare class SquidAPI implements SwapProvider {
    #private;
    id: string;
    name: string;
    isHealthy: boolean | null;
    supportedChains: SwapProvider['supportedChains'];
    constructor({ fetch, integratorId }: {
        fetch: Fetch;
        integratorId: string;
    });
    getHealth(): Promise<boolean>;
    updateHealth(): Promise<void>;
    resetHealth(): void;
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
    quote({ fromAsset, fromChainId, fromTokenAddress, toAsset, toChainId, toTokenAddress, fromAmount, userAddress, isWrapOrUnwrap, accountNativeBalance, nativeSymbol }: ProviderQuoteParams): Promise<SwapAndBridgeQuote>;
    startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest>;
    getRouteStatus({ txHash, fromChainId, toChainId, requestId, routeId }: {
        txHash: string;
        fromChainId: number;
        toChainId: number;
        requestId?: string;
        routeId?: string;
    }): Promise<SwapAndBridgeRouteStatusResult>;
}
//# sourceMappingURL=api.d.ts.map