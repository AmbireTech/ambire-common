import { InviteController } from '../../controllers/invite/invite';
import { Fetch } from '../../interfaces/fetch';
import { SocketAPIToken, SocketRouteStatus, SwapAndBridgeActiveRoute, SwapAndBridgeQuote, SwapAndBridgeRoute, SwapAndBridgeSendTxRequest, SwapAndBridgeSupportedChain, SwapAndBridgeToToken } from '../../interfaces/swapAndBridge';
export declare const normalizeIncomingSocketToken: (token: SocketAPIToken) => {
    address: string;
    chainId: number;
    decimals: number;
    icon: string;
    logoURI: string;
    name: string;
    symbol: string;
};
export declare class SocketAPI {
    #private;
    id: 'socket';
    isHealthy: boolean | null;
    constructor({ fetch, apiKey }: {
        fetch: Fetch;
        apiKey: string;
    });
    getHealth(): Promise<boolean>;
    updateHealth(): Promise<void>;
    updateHealthIfNeeded(): Promise<void>;
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
    quote({ fromChainId, fromTokenAddress, toChainId, toTokenAddress, fromAmount, userAddress, isSmartAccount, sort, isOG }: {
        fromChainId: number;
        fromTokenAddress: string;
        toChainId: number;
        toTokenAddress: string;
        fromAmount: bigint;
        userAddress: string;
        isSmartAccount: boolean;
        sort: 'time' | 'output';
        isOG: InviteController['isOG'];
    }): Promise<SwapAndBridgeQuote>;
    startRoute({ fromChainId, toChainId, fromAssetAddress, toAssetAddress, route }: {
        fromChainId: number;
        toChainId: number;
        fromAssetAddress: string;
        toAssetAddress: string;
        route?: SwapAndBridgeQuote['selectedRoute'];
    }): Promise<SwapAndBridgeSendTxRequest>;
    getRouteStatus({ activeRouteId, userTxIndex, txHash }: {
        activeRouteId: SwapAndBridgeActiveRoute['activeRouteId'];
        userTxIndex: SwapAndBridgeSendTxRequest['userTxIndex'];
        txHash: string;
    }): Promise<SocketRouteStatus>;
    getActiveRoute(activeRouteId: SwapAndBridgeActiveRoute['activeRouteId']): Promise<SwapAndBridgeRoute>;
    getNextRouteUserTx({ activeRouteId }: {
        activeRouteId: SwapAndBridgeSendTxRequest['activeRouteId'];
    }): Promise<{
        activeRouteId: string;
        approvalData: import("../../interfaces/swapAndBridge").SocketAPIUserTxApprovalData | null;
        chainId: number;
        totalUserTx: number;
        txData: string;
        txTarget: string;
        txType: "eth_sendTransaction";
        userTxIndex: number;
        userTxType: "fund-movr" | "dex-swap";
        value: string;
    }>;
}
//# sourceMappingURL=api.d.ts.map