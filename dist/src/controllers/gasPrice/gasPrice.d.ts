import { ErrorRef } from '../../interfaces/eventEmitter';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { BaseAccount } from '../../libs/account/BaseAccount';
import { GasSpeeds } from '../../services/bundlers/types';
import { EstimationController } from '../estimation/estimation';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare class GasPriceController extends EventEmitter {
    #private;
    gasPrices?: GasSpeeds;
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
     * */
    areGasPricesUsedFromBundlerEstimation: boolean;
    constructor(network: Network, provider: RPCProvider, baseAccount: BaseAccount, getSignAccountOpState: () => {
        estimation: EstimationController;
        readyToSign: boolean;
        stopRefetching: boolean;
    });
    fetch(emitLevelOnFailure?: ErrorRef['level']): Promise<void>;
    destroy(): void;
}
//# sourceMappingURL=gasPrice.d.ts.map