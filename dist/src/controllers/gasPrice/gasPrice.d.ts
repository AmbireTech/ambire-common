import { BUNDLER } from '../../consts/bundlers';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { GasRecommendation } from '../../libs/gasPrice/gasPrice';
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher';
import { GasSpeeds } from '../../services/bundlers/types';
import { EstimationController } from '../estimation/estimation';
import EventEmitter, { ErrorRef } from '../eventEmitter/eventEmitter';
export declare class GasPriceController extends EventEmitter {
    #private;
    gasPrices: {
        [key: string]: GasRecommendation[];
    };
    bundlerGasPrices: {
        [key: string]: {
            speeds: GasSpeeds;
            bundler: BUNDLER;
        };
    };
    blockGasLimit: bigint | undefined;
    stopRefetching: boolean;
    constructor(network: Network, provider: RPCProvider, bundlerSwitcher: BundlerSwitcher, getSignAccountOpState: () => {
        estimation: EstimationController;
        readyToSign: boolean;
        isSignRequestStillActive: Function;
    });
    refetch(): Promise<void>;
    fetch(emitLevelOnFailure?: ErrorRef['level']): Promise<void>;
    reset(): void;
}
//# sourceMappingURL=gasPrice.d.ts.map