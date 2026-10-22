import { Interface } from 'ethers';
import { CowSwapOrderCreation, CowSwapOrderStruct, SwapAndBridgeToToken } from '../../interfaces/swapAndBridge';
import { CowSwapTokenListEntry } from './types';
export declare const settlementInterface: Interface;
export declare const ethFlowInterface: Interface;
export declare const isCowSwapTokenListEntry: (value: unknown) => value is CowSwapTokenListEntry;
export declare const normalizeCowSwapToken: (token: CowSwapTokenListEntry) => SwapAndBridgeToToken;
export declare const getApiNetwork: (chainId: number) => string;
export declare const getWrappedNativeTokenAddress: (chainId: number) => string;
export declare const normalizeBuyTokenAddress: (address: string) => string;
export declare const getProtocolFeeAmount: (buyAmount: bigint, protocolFeeBps: number) => bigint;
export declare const buildAppData: ({ slippageBps, feeBps }: {
    slippageBps: number;
    feeBps?: number;
}) => {
    fullAppData: string;
    appDataHash: string;
};
/** Picks the fields of an order we submit to CoW Swap that its order ID commits to. */
export declare const getCowSwapOrderStruct: (order: CowSwapOrderCreation) => CowSwapOrderStruct;
/**
 * Builds the CoW Swap order ID (`orderUid`) of `order` owned by `owner` on `chainId`: the EIP-712
 * hash of the order, followed by the owner and the order's expiry. Pre-sign and cancel
 * transactions contain only this ID, so recomputing it from an order is how we prove which order
 * such a transaction refers to. Throws if a field of `order` can't be encoded.
 */
export declare const getCowSwapOrderUid: ({ chainId, order, owner }: {
    chainId: number | bigint;
    order: CowSwapOrderStruct;
    owner: string;
}) => string;
export declare const computeOrderUid: ({ chainId, order, owner, isEthFlow }: {
    chainId: number;
    order: CowSwapOrderCreation;
    owner: string;
    isEthFlow: boolean;
}) => string;
export declare const getOutputValueInUsd: ({ inputValueInUsd, toAsset, toAmount, buyAmountBeforeFees }: {
    inputValueInUsd: number;
    toAsset: SwapAndBridgeToToken;
    toAmount: string;
    buyAmountBeforeFees: bigint;
}) => number;
//# sourceMappingURL=helper.d.ts.map