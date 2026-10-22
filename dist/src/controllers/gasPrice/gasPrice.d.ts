import { ErrorRef } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { BaseAccount } from '../../libs/account/BaseAccount';
import { GasSpeeds } from '../../services/bundlers/types';
import { EstimationController } from '../estimation/estimation';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare class GasPriceController extends EventEmitter {
    #private;
    /**
     * The gas prices for the account. With the `rpcWithBundlerFallback` strategy
     * (see BaseAccount.getGasPriceFetchStrategy), these mirror rpcGasPrices and
     * signAccountOp uses them only while there's no bundler estimation to take
     * the bundler gas prices from
     */
    gasPrices?: GasSpeeds;
    /**
     * The gas prices for broadcasts outside the bundler. Set only with the
     * `rpcWithBundlerFallback` strategy (see BaseAccount.getGasPriceFetchStrategy).
     * Despite the name, they hold the bundler gas prices if the RPC has failed and
     * the bundler fallback has succeeded, so those broadcasts could still proceed
     */
    rpcGasPrices?: GasSpeeds;
    /**
     * Timestamp of the last successful gas price update
     * TODO: Merge them into a single structure
     * {
     *  gasPrices: GasSpeeds
     *  updatedAt: number
     * }
     */
    updatedAt?: number;
    /**
     * If the bundler estimation succeeds successfully, we don't want
     * to use the estimation from the gas price controller unless
     * explicitly called from the signAccountOp.
     * Accounts with the `rpcWithBundlerFallback` strategy still fetch their RPC
     * gas prices (see BaseAccount.getGasPriceFetchStrategy)
     * */
    areGasPricesUsedFromBundlerEstimation: boolean;
    constructor(network: Network, provider: RPCProvider, baseAccount: BaseAccount, getSignAccountOpState: () => {
        estimation: EstimationController;
        readyToSign: boolean;
        stopRefetching: boolean;
    }, featureFlags: IFeatureFlagsController);
    setBaseAccount(baseAccount: BaseAccount): void;
    fetch(emitLevelOnFailure?: ErrorRef['level']): Promise<void>;
    destroy(): void;
}
//# sourceMappingURL=gasPrice.d.ts.map