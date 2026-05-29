import { BUNDLER } from '../../consts/bundlers';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { BundlerEstimateResult, BundlerStateOverride } from '../../libs/estimate/interfaces';
import { UserOperation } from '../../libs/userOperation/types';
import { Bundler } from './bundler';
import { GasSpeeds, UserOpStatus } from './types';
export declare class Gelato extends Bundler {
    protected getUrl(network: Network): string;
    /**
     * Get the bundler RPC
     *
     * @param network
     */
    protected getProvider(network: Network): RPCProvider;
    protected getGasPrice(network: Network): Promise<GasSpeeds>;
    estimate(userOperation: UserOperation, network: Network, stateOverride?: BundlerStateOverride): Promise<BundlerEstimateResult>;
    getStatus(network: Network, userOpHash: string): Promise<UserOpStatus>;
    getName(): BUNDLER;
    shouldReestimateBeforeBroadcast(network: Network): boolean;
}
//# sourceMappingURL=gelato.d.ts.map