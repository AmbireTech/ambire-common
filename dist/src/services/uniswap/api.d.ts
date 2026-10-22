import { Fetch } from '../../interfaces/fetch';
import { ProviderQuoteParams, SwapAndBridgeQuote, SwapAndBridgeRoute, SwapAndBridgeRouteStatusResult, SwapAndBridgeSendTxRequest, SwapAndBridgeSupportedChain, SwapAndBridgeToToken, SwapProvider } from '../../interfaces/swapAndBridge';
export declare class UniswapAPI implements SwapProvider {
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
    resetHealth(): void;
    areChainsSupported({ fromChainId, toChainId }: {
        fromChainId: number;
        toChainId: number;
    }): boolean;
    getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]>;
    getToTokenList({ fromChainId, toChainId }: {
        fromChainId: number;
        toChainId: number;
    }): Promise<SwapAndBridgeToToken[]>;
    getToken({ address, chainId }: {
        address: string;
        chainId: number;
    }): Promise<SwapAndBridgeToToken | null>;
    quote({ fromAsset, fromChainId, fromTokenAddress, toAsset, toChainId, toTokenAddress, fromAmount, userAddress, isWrapOrUnwrap, feePercent }: ProviderQuoteParams): Promise<SwapAndBridgeQuote>;
    startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest>;
    getRouteStatus({ txHash, fromChainId, toChainId, bridge }: {
        txHash: string;
        fromChainId: number;
        toChainId: number;
        bridge?: string;
    }): Promise<SwapAndBridgeRouteStatusResult>;
}
//# sourceMappingURL=api.d.ts.map