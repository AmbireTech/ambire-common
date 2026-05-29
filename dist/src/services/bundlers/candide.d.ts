import { BUNDLER } from '../../consts/bundlers';
import { Network } from '../../interfaces/network';
import { BundlerEstimateResult, BundlerStateOverride } from '../../libs/estimate/interfaces';
import { UserOperation } from '../../libs/userOperation/types';
import { Bundler } from './bundler';
import { GasSpeeds, UserOpStatus } from './types';
export declare class Candide extends Bundler {
    protected getUrl(network: Network): string;
    protected getGasPrice(network: Network): Promise<GasSpeeds>;
    getStatus(network: Network, userOpHash: string): Promise<UserOpStatus>;
    estimate(userOperation: UserOperation, network: Network, stateOverride?: BundlerStateOverride): Promise<BundlerEstimateResult>;
    getName(): BUNDLER;
    shouldReestimateBeforeBroadcast(network: Network): boolean;
}
//# sourceMappingURL=candide.d.ts.map