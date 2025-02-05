import { Fetch } from '../../interfaces/fetch';
import { SocketAPIQuote, SocketAPISendTransactionRequest, SocketAPIToken } from '../../interfaces/swapAndBridge';
export declare class SocketAPIMock {
    #private;
    isHealthy: boolean | null;
    constructor({ fetch, apiKey }: {
        fetch: Fetch;
        apiKey: string;
    });
    getHealth(): Promise<boolean>;
    updateHealth(): Promise<void>;
    resetHealth(): void;
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
            totalUserTx: number;
            sender: string;
            recipient: string;
            totalGasFeesInUsd: number;
            receivedValueInUsd: number;
            inputValueInUsd: number;
            outputValueInUsd: number;
            userTxs: ({
                userTxType: string;
                txType: string;
                chainId: number;
                toAmount: string;
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
                        chainAgnosticId: null;
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
                        chainAgnosticId: null;
                    };
                    toAmount: string;
                    swapSlippage: number;
                    minAmountOut: string;
                    gasFees: {
                        gasAmount: string;
                        gasLimit: number;
                        asset: {
                            chainId: number;
                            address: string;
                            symbol: string;
                            name: string;
                            decimals: number;
                            icon: string;
                            logoURI: string;
                            chainAgnosticId: null;
                        };
                        feesInUsd: number;
                    };
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
                        chainAgnosticId: null;
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
                            chainAgnosticId: null;
                        };
                        feesInUsd: number;
                        amount: string;
                    };
                    gasFees: {
                        gasAmount: string;
                        asset: {
                            chainId: number;
                            address: string;
                            symbol: string;
                            name: string;
                            decimals: number;
                            icon: string;
                            logoURI: string;
                            chainAgnosticId: null;
                        };
                        gasLimit: number;
                        feesInUsd: number;
                    };
                    serviceTime: number;
                    maxServiceTime: number;
                    extraData: {
                        rewards: never[];
                    };
                    chainId?: undefined;
                    swapSlippage?: undefined;
                })[];
                gasFees: {
                    gasAmount: string;
                    feesInUsd: number;
                    asset: {
                        chainId: number;
                        address: string;
                        symbol: string;
                        name: string;
                        decimals: number;
                        icon: string;
                        logoURI: string;
                        chainAgnosticId: null;
                    };
                    gasLimit: number;
                };
                serviceTime: number;
                recipient: string;
                maxServiceTime: number;
                bridgeSlippage: number;
                swapSlippage: number;
                userTxIndex: number;
                protocol?: undefined;
                fromAsset?: undefined;
                fromAmount?: undefined;
                minAmountOut?: undefined;
            } | {
                userTxType: string;
                txType: string;
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
                approvalData: null;
                fromAmount: string;
                toAsset: {
                    chainId: number;
                    address: string;
                    symbol: string;
                    name: string;
                    decimals: number;
                    icon: null;
                    logoURI: null;
                    chainAgnosticId: null;
                };
                toAmount: string;
                minAmountOut: string;
                gasFees: {
                    gasAmount: string;
                    gasLimit: number;
                    asset: {
                        chainId: number;
                        address: string;
                        symbol: string;
                        name: string;
                        decimals: number;
                        icon: string;
                        logoURI: string;
                        chainAgnosticId: string;
                    };
                    feesInUsd: number;
                };
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
                    chainAgnosticId: null;
                };
            };
            extraData: {
                rewards: never[];
            };
        }[];
        socketRoute: null;
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
            chainAgnosticId: null;
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
            chainAgnosticId: null;
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
    startRoute({ fromChainId, fromAssetAddress }: {
        fromChainId: number;
        toChainId: number;
        fromAssetAddress: string;
        toAssetAddress: string;
        route: SocketAPIQuote['selectedRoute'];
    }): Promise<{
        userTxType: string;
        txType: string;
        txData: string;
        txTarget: string;
        chainId: number;
        totalUserTx: number;
        userTxIndex: number;
        activeRouteId: number;
        value: string;
        approvalData: {
            minimumApprovalAmount: string;
            approvalTokenAddress: string;
            allowanceTarget: string;
            owner: string;
        };
    }>;
    getRouteStatus(props: {
        activeRouteId: SocketAPISendTransactionRequest['activeRouteId'];
        userTxIndex: SocketAPISendTransactionRequest['userTxIndex'];
        txHash: string;
    }): Promise<"ready" | "completed">;
    updateActiveRoute(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']): Promise<{
        activeRouteId: number;
        userAddress: string;
        totalUserTx: number;
        userTxs: ({
            steps: ({
                type: string;
                chainId: number;
                gasFees: {
                    asset: {
                        icon: string;
                        name: string;
                        symbol: string;
                        address: string;
                        chainId: number;
                        logoURI: string;
                        decimals: number;
                        chainAgnosticId: null;
                    };
                    gasLimit: number;
                    feesInUsd: number;
                    gasAmount: string;
                };
                toAsset: {
                    icon: string;
                    name: string;
                    symbol: string;
                    address: string;
                    chainId: number;
                    logoURI: string;
                    decimals: number;
                    chainAgnosticId: null;
                };
                protocol: {
                    icon: string;
                    name: string;
                    displayName: string;
                    securityScore?: undefined;
                    robustnessScore?: undefined;
                };
                toAmount: string;
                fromAsset: {
                    icon: string;
                    name: string;
                    symbol: string;
                    address: string;
                    chainId: number;
                    logoURI: string;
                    decimals: number;
                    chainAgnosticId: null;
                };
                fromAmount: string;
                minAmountOut: string;
                swapSlippage: number;
                extraData?: undefined;
                toChainId?: undefined;
                fromChainId?: undefined;
                serviceTime?: undefined;
                protocolFees?: undefined;
                bridgeSlippage?: undefined;
                maxServiceTime?: undefined;
            } | {
                type: string;
                gasFees: {
                    asset: {
                        icon: string;
                        name: string;
                        symbol: string;
                        address: string;
                        chainId: number;
                        logoURI: string;
                        decimals: number;
                        chainAgnosticId: null;
                    };
                    gasLimit: number;
                    feesInUsd: number;
                    gasAmount: string;
                };
                toAsset: {
                    icon: string;
                    name: string;
                    symbol: string;
                    address: string;
                    chainId: number;
                    logoURI: string;
                    decimals: number;
                    chainAgnosticId: string;
                };
                protocol: {
                    icon: string;
                    name: string;
                    displayName: string;
                    securityScore: number;
                    robustnessScore: number;
                };
                toAmount: string;
                extraData: {
                    rewards: never[];
                };
                fromAsset: {
                    icon: string;
                    name: string;
                    symbol: string;
                    address: string;
                    chainId: number;
                    logoURI: string;
                    decimals: number;
                    chainAgnosticId: null;
                };
                toChainId: number;
                fromAmount: string;
                fromChainId: number;
                serviceTime: number;
                minAmountOut: string;
                protocolFees: {
                    asset: {
                        icon: string;
                        name: string;
                        symbol: string;
                        address: string;
                        chainId: number;
                        logoURI: string;
                        decimals: number;
                        chainAgnosticId: null;
                    };
                    amount: string;
                    feesInUsd: number;
                };
                bridgeSlippage: number;
                maxServiceTime: number;
                chainId?: undefined;
                swapSlippage?: undefined;
            })[];
            sender: string;
            txType: string;
            chainId: number;
            gasFees: {
                asset: {
                    icon: string;
                    name: string;
                    symbol: string;
                    address: string;
                    chainId: number;
                    logoURI: string;
                    decimals: number;
                    chainAgnosticId: null;
                };
                gasLimit: number;
                feesInUsd: number;
                gasAmount: string;
            };
            toAsset: {
                icon: string;
                name: string;
                symbol: string;
                address: string;
                chainId: number;
                logoURI: string;
                decimals: number;
                chainAgnosticId: string;
            };
            toAmount: string;
            recipient: string;
            routePath: string;
            stepCount: number;
            userTxType: string;
            serviceTime: number;
            userTxIndex: number;
            approvalData: {
                owner: string;
                allowanceTarget: string;
                approvalTokenAddress: string;
                minimumApprovalAmount: string;
            };
            swapSlippage: number;
            userTxStatus: string;
            bridgeSlippage: number;
            maxServiceTime: number;
            destinationTxHash: string;
            destinationTxReceipt: {
                to: string;
                from: string;
                logs: {
                    data: string;
                    topics: string[];
                    address: string;
                    logIndex: number;
                    blockHash: string;
                    blockNumber: number;
                    transactionHash: string;
                    transactionIndex: number;
                }[];
                type: number;
                status: number;
                gasUsed: {
                    hex: string;
                    type: string;
                };
                blockHash: string;
                byzantium: boolean;
                logsBloom: string;
                blockNumber: number;
                confirmations: number;
                contractAddress: null;
                transactionHash: string;
                transactionIndex: number;
                cumulativeGasUsed: {
                    hex: string;
                    type: string;
                };
                effectiveGasPrice: {
                    hex: string;
                    type: string;
                };
            };
            sourceTransactionHash: string;
            sourceTransactionReceipt: {
                to: string;
                from: string;
                logs: never[];
                type: number;
                status: number;
                gasUsed: {
                    hex: string;
                    type: string;
                };
                blockHash: string;
                byzantium: boolean;
                logsBloom: string;
                blockNumber: number;
                confirmations: number;
                contractAddress: null;
                transactionHash: string;
                transactionIndex: number;
                cumulativeGasUsed: {
                    hex: string;
                    type: string;
                };
                effectiveGasPrice: {
                    hex: string;
                    type: string;
                };
            };
            protocol?: undefined;
            fromAsset?: undefined;
            fromAmount?: undefined;
            minAmountOut?: undefined;
        } | {
            sender: string;
            txType: string;
            chainId: number;
            gasFees: {
                asset: {
                    icon: string;
                    name: string;
                    symbol: string;
                    address: string;
                    chainId: number;
                    logoURI: string;
                    decimals: number;
                    chainAgnosticId: string;
                };
                gasLimit: number;
                feesInUsd: number;
                gasAmount: string;
            };
            toAsset: {
                icon: null;
                name: string;
                symbol: string;
                address: string;
                chainId: number;
                logoURI: null;
                decimals: number;
                chainAgnosticId: null;
            };
            protocol: {
                icon: string;
                name: string;
                displayName: string;
            };
            toAmount: string;
            fromAsset: {
                icon: string;
                name: string;
                symbol: string;
                address: string;
                chainId: number;
                logoURI: string;
                decimals: number;
                chainAgnosticId: string;
            };
            recipient: string;
            fromAmount: string;
            userTxType: string;
            userTxIndex: number;
            approvalData: null;
            minAmountOut: string;
            swapSlippage: number;
            steps?: undefined;
            routePath?: undefined;
            stepCount?: undefined;
            serviceTime?: undefined;
            userTxStatus?: undefined;
            bridgeSlippage?: undefined;
            maxServiceTime?: undefined;
            destinationTxHash?: undefined;
            destinationTxReceipt?: undefined;
            sourceTransactionHash?: undefined;
            sourceTransactionReceipt?: undefined;
        })[];
        fromChainId: number;
        toChainId: number;
        fromAssetAddress: string;
        toAssetAddress: string;
        fromAmount: string;
        toAmount: string;
        refuel: null;
        routeStatus: string;
        transactionData: {
            '0': {
                txHash: string;
                chainId: number;
            };
        };
        bridgeTxHash: string;
        recipient: string;
        integratorId: number;
        destinationCallData: null;
        bridgeInsuranceData: null;
        integratorFee: {
            asset: {
                icon: string;
                name: string;
                symbol: string;
                address: string;
                chainId: number;
                logoURI: string;
                decimals: number;
                chainAgnosticId: null;
            };
            amount: string;
        };
        createdAt: string;
        updatedAt: string;
        currentUserTxIndex: number;
        fromAsset: {
            chainId: number;
            address: string;
            symbol: string;
            name: string;
            decimals: number;
            icon: string;
            logoURI: string;
            chainAgnosticId: null;
        };
        toAsset: {
            chainId: number;
            address: string;
            symbol: string;
            name: string;
            decimals: number;
            icon: string;
            logoURI: string;
            chainAgnosticId: null;
        };
    }>;
    getNextRouteUserTx(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']): Promise<{
        userTxType: string;
        txType: string;
        txData: string;
        txTarget: string;
        chainId: number;
        totalUserTx: number;
        activeRouteId: number;
        value: string;
        userTxIndex: number;
        approvalData: null;
    }>;
}
//# sourceMappingURL=socketApiMock.d.ts.map