import { BUNDLER } from '../../consts/bundlers';
import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { DecodedError } from '../../libs/errorDecoder/types';
import { BundlerEstimateResult, BundlerStateOverride } from '../../libs/estimate/interfaces';
import { UserOperation } from '../../libs/userOperation/types';
import { BundlerTransactionReceipt, GasSpeeds, UserOpStatus } from './types';
export declare abstract class Bundler {
    /**
     * The default pollWaitTime. This is used to determine
     * how many milliseconds to wait until before another request to the
     * bundler for the receipt is sent
     */
    pollWaitTime: number;
    /**
     * Define the bundler URL
     */
    protected abstract getUrl(network: Network): string;
    /**
     * Each bundler has their own gas prices. Define and fetch them
     */
    protected abstract getGasPrice(network: Network): Promise<GasSpeeds>;
    /**
     * Each bundler has it's own handler for giving information back
     */
    abstract getStatus(network: Network, userOpHash: string): Promise<UserOpStatus>;
    /**
     * Each bundler needs to return its own na,e
     */
    abstract getName(): BUNDLER;
    /**
     * Each bundler should declare the conditions upon a reestimate before
     * broadcast is needed
     */
    abstract shouldReestimateBeforeBroadcast(network: Network): boolean;
    /**
     * Get the bundler RPC
     *
     * @param network
     */
    protected getProvider(network: Network): RPCProvider;
    protected sendEstimateReq(userOperation: UserOperation, network: Network, stateOverride?: BundlerStateOverride): Promise<BundlerEstimateResult>;
    estimate(userOperation: UserOperation, network: Network, stateOverride?: BundlerStateOverride): Promise<BundlerEstimateResult>;
    /**
     * Get the transaction receipt from the userOperationHash if ready
     *
     * @param userOperationHash
     * @returns Receipt | null
     */
    getReceipt(userOperationHash: string, network: Network): Promise<BundlerTransactionReceipt>;
    /**
     * Broadcast a userOperation to the specified bundler and get a userOperationHash in return
     *
     * @param UserOperation userOperation
     * @returns userOperationHash
     */
    broadcast(userOperation: UserOperation, network: Network): Promise<string>;
    static isNetworkSupported(fetch: Fetch, chainId: bigint): Promise<boolean>;
    fetchGasPrices(network: Network): Promise<GasSpeeds>;
    decodeBundlerError(e: Error): DecodedError;
    /**
     * Different bundlers return the success flag differently:
     * - number, string (0,1), string (success)
     * We make it one and the same here
     */
    static getReceiptSuccess(bundlerTransactionReceipt: BundlerTransactionReceipt): bigint;
}
//# sourceMappingURL=bundler.d.ts.map