import { Fetch } from '../../interfaces/fetch';
import { SocketAPIToken, SwapAndBridgeRoute, SwapAndBridgeSendTxRequest } from '../../interfaces/swapAndBridge';
export declare class SocketAPIMock {
    #private;
    id: string;
    name: string;
    isHealthy: boolean | null;
    constructor({ fetch, apiKey }: {
        fetch: Fetch;
        apiKey: string;
    });
    getHealth(): Promise<boolean>;
    updateHealth(): Promise<void>;
    resetHealth(): void;
    getSupportedChains(): Promise<{
        chainId: bigint;
    }[]>;
    getToTokenList({ toChainId }: {
        fromChainId: number;
        toChainId: number;
    }): Promise<SocketAPIToken[]>;
    quote({ fromChainId, fromTokenAddress, toChainId, toTokenAddress, fromAmount, userAddress }: {
        fromChainId: number;
        fromTokenAddress: string;
        toChainId: number;
        toTokenAddress: string;
        fromAmount: bigint;
        userAddress: string;
        isSmartAccount: boolean;
        sort: 'time' | 'output';
    }): Promise<{
        routes: {
            routeId: string;
            isOnlySwapRoute: boolean;
            fromAmount: bigint;
            toAmount: string;
            fromChainId: number;
            toChainId: number;
            usedBridgeNames: string[];
            minimumGasBalances: {
                '10': string;
                '8453': string;
            };
            chainGasBalances: {
                '10': {
                    minGasBalance: string;
                    hasGasBalance: boolean;
                };
                '8453': {
                    minGasBalance: string;
                    hasGasBalance: boolean;
                };
            };
            sender: string;
            recipient: string;
            inputValueInUsd: number;
            outputValueInUsd: number;
            toToken: {
                chainId: number;
                address: string;
                symbol: string;
                name: string;
                decimals: number;
                icon: string;
                logoURI: string;
                chainAgnosticId: string;
            };
            userTxs: ({
                chainId: number;
                toAmount: string;
                fromAsset: {
                    chainId: number;
                    address: string;
                    symbol: string;
                    name: string;
                    decimals: number;
                    icon: string;
                    logoURI: string;
                    chainAgnosticId: any;
                };
                toAsset: {
                    chainId: number;
                    address: string;
                    symbol: string;
                    name: string;
                    decimals: number;
                    icon: string;
                    logoURI: string;
                    chainAgnosticId: string;
                };
                stepCount: number;
                routePath: string;
                sender: string;
                approvalData: {
                    minimumApprovalAmount: bigint;
                    approvalTokenAddress: string;
                    allowanceTarget: string;
                    owner: string;
                };
                steps: ({
                    type: string;
                    protocol: {
                        name: string;
                        displayName: string;
                        icon: string;
                        securityScore?: undefined;
                        robustnessScore?: undefined;
                    };
                    chainId: number;
                    fromAsset: {
                        chainId: number;
                        address: string;
                        symbol: string;
                        name: string;
                        decimals: number;
                        icon: string;
                        logoURI: string;
                        chainAgnosticId: any;
                    };
                    fromAmount: bigint;
                    toAsset: {
                        chainId: number;
                        address: string;
                        symbol: string;
                        name: string;
                        decimals: number;
                        icon: string;
                        logoURI: string;
                        chainAgnosticId: any;
                    };
                    toAmount: string;
                    swapSlippage: number;
                    minAmountOut: string;
                    bridgeSlippage?: undefined;
                    fromChainId?: undefined;
                    toChainId?: undefined;
                    protocolFees?: undefined;
                    serviceTime?: undefined;
                    maxServiceTime?: undefined;
                    extraData?: undefined;
                } | {
                    type: string;
                    protocol: {
                        name: string;
                        displayName: string;
                        icon: string;
                        securityScore: number;
                        robustnessScore: number;
                    };
                    bridgeSlippage: number;
                    fromChainId: number;
                    fromAsset: {
                        chainId: number;
                        address: string;
                        symbol: string;
                        name: string;
                        decimals: number;
                        icon: string;
                        logoURI: string;
                        chainAgnosticId: any;
                    };
                    fromAmount: string;
                    toChainId: number;
                    toAsset: {
                        chainId: number;
                        address: string;
                        symbol: string;
                        name: string;
                        decimals: number;
                        icon: string;
                        logoURI: string;
                        chainAgnosticId: string;
                    };
                    minAmountOut: string;
                    toAmount: string;
                    protocolFees: {
                        asset: {
                            chainId: number;
                            address: string;
                            symbol: string;
                            name: string;
                            decimals: number;
                            icon: string;
                            logoURI: string;
                            chainAgnosticId: any;
                        };
                        feesInUsd: number;
                        amount: string;
                    };
                    serviceTime: number;
                    maxServiceTime: number;
                    extraData: {
                        rewards: any[];
                    };
                    chainId?: undefined;
                    swapSlippage?: undefined;
                })[];
                serviceTime: number;
                recipient: string;
                maxServiceTime: number;
                bridgeSlippage: number;
                swapSlippage: number;
                userTxIndex: number;
                protocol?: undefined;
                fromAmount?: undefined;
                minAmountOut?: undefined;
            } | {
                swapSlippage: number;
                chainId: number;
                protocol: {
                    name: string;
                    displayName: string;
                    icon: string;
                };
                fromAsset: {
                    chainId: number;
                    address: string;
                    symbol: string;
                    name: string;
                    decimals: number;
                    icon: string;
                    logoURI: string;
                    chainAgnosticId: string;
                };
                approvalData: any;
                fromAmount: string;
                toAsset: {
                    chainId: number;
                    address: string;
                    symbol: string;
                    name: string;
                    decimals: number;
                    icon: any;
                    logoURI: any;
                    chainAgnosticId: any;
                };
                toAmount: string;
                minAmountOut: string;
                sender: string;
                recipient: string;
                userTxIndex: number;
                stepCount?: undefined;
                routePath?: undefined;
                steps?: undefined;
                serviceTime?: undefined;
                maxServiceTime?: undefined;
                bridgeSlippage?: undefined;
            })[];
            serviceTime: number;
            maxServiceTime: number;
            integratorFee: {
                amount: string;
                asset: {
                    chainId: number;
                    address: string;
                    symbol: string;
                    name: string;
                    decimals: number;
                    icon: string;
                    logoURI: string;
                    chainAgnosticId: any;
                };
            };
            extraData: {
                rewards: any[];
            };
        }[];
        socketRoute: any;
        destinationCallData: {};
        fromChainId: number;
        fromAsset: {
            chainId: number;
            address: string;
            symbol: string;
            name: string;
            decimals: number;
            icon: string;
            logoURI: string;
            chainAgnosticId: any;
        };
        toChainId: number;
        toAsset: {
            chainId: number;
            address: string;
            symbol: string;
            name: string;
            decimals: number;
            icon: string;
            logoURI: string;
            chainAgnosticId: any;
        };
        bridgeRouteErrors: {
            cctp: {
                status: string;
            };
            'stargate-v2': {
                status: string;
            };
            across: {
                status: string;
            };
            symbiosis: {
                status: string;
            };
            'refuel-bridge': {
                status: string;
            };
            hop: {
                status: string;
            };
            synapse: {
                status: string;
            };
            'polygon-bridge': {
                status: string;
            };
            hyphen: {
                status: string;
            };
            'arbitrum-bridge': {
                status: string;
            };
            'anyswap-router-v4': {
                status: string;
            };
            'anyswap-router-v6': {
                status: string;
            };
            hopCctp: {
                status: string;
            };
            celer: {
                status: string;
            };
            'optimism-bridge': {
                status: string;
            };
            connext: {
                status: string;
            };
            'base-bridge': {
                status: string;
            };
            'zora-bridge': {
                status: string;
            };
            'zksync-native': {
                status: string;
            };
            'gnosis-native-bridge': {
                status: string;
            };
            'mantle-native-bridge': {
                status: string;
            };
            'scroll-native-bridge': {
                status: string;
            };
            'mode-native-bridge': {
                status: string;
            };
            'super-bridge': {
                status: string;
            };
        };
    }>;
    startRoute({ route }: {
        route: SwapAndBridgeRoute;
    }): Promise<SwapAndBridgeSendTxRequest>;
    getRouteStatus({ txHash }: {
        txHash: string;
    }): Promise<{
        status: string;
        txnId: string;
    }>;
}
//# sourceMappingURL=socketApiMock.d.ts.map