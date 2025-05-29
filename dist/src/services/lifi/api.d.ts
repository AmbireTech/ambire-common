import { InviteController } from '../../controllers/invite/invite';
import { Fetch } from '../../interfaces/fetch';
import { SwapAndBridgeActiveRoute, SwapAndBridgeQuote, SwapAndBridgeRoute, SwapAndBridgeRouteStatus, SwapAndBridgeSendTxRequest, SwapAndBridgeSupportedChain, SwapAndBridgeToToken } from '../../interfaces/swapAndBridge';
import { TokenResult } from '../../libs/portfolio';
export declare class LiFiAPI {
    #private;
    id: 'lifi';
    isHealthy: boolean | null;
    constructor({ apiKey, fetch }: {
        apiKey?: string;
        fetch: Fetch;
    });
    getHealth(): Promise<boolean>;
    updateHealth(): Promise<void>;
    updateHealthIfNeeded(): Promise<void>;
    resetHealth(): void;
    getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]>;
    getToTokenList({ toChainId }: {
        fromChainId: number;
        toChainId: number;
    }): Promise<SwapAndBridgeToToken[]>;
    getToken({ address: token, chainId }: {
        address: string;
        chainId: number;
    }): Promise<SwapAndBridgeToToken | null>;
    quote({ fromAsset, fromChainId, fromTokenAddress, toAsset, toChainId, toTokenAddress, fromAmount, userAddress, sort, isOG }: {
        fromAsset: TokenResult | null;
        fromChainId: number;
        fromTokenAddress: string;
        toAsset: SwapAndBridgeToToken | null;
        toChainId: number;
        toTokenAddress: string;
        fromAmount: bigint;
        userAddress: string;
        isSmartAccount: boolean;
        sort: 'time' | 'output';
        isOG: InviteController['isOG'];
    }): Promise<SwapAndBridgeQuote>;
    startRoute({ route }: {
        fromChainId?: number;
        toChainId?: number;
        fromAssetAddress?: string;
        toAssetAddress?: string;
        route?: SwapAndBridgeRoute;
    }): Promise<SwapAndBridgeSendTxRequest>;
    getRouteStatus({ txHash, fromChainId, toChainId, bridge }: {
        activeRouteId: SwapAndBridgeActiveRoute['activeRouteId'];
        userTxIndex: SwapAndBridgeSendTxRequest['userTxIndex'];
        txHash: string;
        fromChainId: number;
        toChainId: number;
        bridge?: string;
    }): Promise<SwapAndBridgeRouteStatus>;
    /**
     * NOT SUPPORTED: LiFi has no concept for retrieving active routes from the API.
     * @deprecated
     */
    getActiveRoute(): Promise<null>;
    getNextRouteUserTx({ route }: {
        activeRouteId: SwapAndBridgeSendTxRequest['activeRouteId'];
        route: SwapAndBridgeRoute;
    }): Promise<SwapAndBridgeSendTxRequest>;
}
//# sourceMappingURL=api.d.ts.map