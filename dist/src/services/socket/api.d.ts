import { InviteController } from '../../controllers/invite/invite';
import { Fetch } from '../../interfaces/fetch';
import { SocketAPIActiveRoutes, SocketAPIQuote, SocketAPISendTransactionRequest, SocketAPISupportedChain, SocketAPIToken, SocketRouteStatus } from '../../interfaces/swapAndBridge';
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
    isHealthy: boolean | null;
    constructor({ fetch, apiKey }: {
        fetch: Fetch;
        apiKey: string;
    });
    getHealth(): Promise<boolean>;
    updateHealth(): Promise<void>;
    updateHealthIfNeeded(): Promise<void>;
    resetHealth(): void;
    getSupportedChains(): Promise<SocketAPISupportedChain[]>;
    getToTokenList({ fromChainId, toChainId }: {
        fromChainId: number;
        toChainId: number;
    }): Promise<SocketAPIToken[]>;
    getToken({ address, chainId }: {
        address: string;
        chainId: number;
    }): Promise<SocketAPIToken | null>;
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
    }): Promise<SocketAPIQuote>;
    startRoute({ fromChainId, toChainId, fromAssetAddress, toAssetAddress, route }: {
        fromChainId: number;
        toChainId: number;
        fromAssetAddress: string;
        toAssetAddress: string;
        route: SocketAPIQuote['selectedRoute'];
    }): Promise<SocketAPISendTransactionRequest>;
    getRouteStatus({ activeRouteId, userTxIndex, txHash }: {
        activeRouteId: SocketAPISendTransactionRequest['activeRouteId'];
        userTxIndex: SocketAPISendTransactionRequest['userTxIndex'];
        txHash: string;
    }): Promise<SocketRouteStatus>;
    updateActiveRoute(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']): Promise<SocketAPIActiveRoutes>;
    getNextRouteUserTx(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']): Promise<SocketAPISendTransactionRequest>;
}
//# sourceMappingURL=api.d.ts.map