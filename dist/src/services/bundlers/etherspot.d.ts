import { BUNDLER } from '../../consts/bundlers';
import { Network } from '../../interfaces/network';
import { Bundler } from './bundler';
import { GasSpeeds, UserOpStatus } from './types';
export declare class Etherspot extends Bundler {
    protected getUrl(network: Network): string;
    protected getGasPrice(network: Network): Promise<GasSpeeds>;
    getStatus(network: Network, userOpHash: string): Promise<UserOpStatus>;
    getName(): BUNDLER;
    shouldReestimateBeforeBroadcast(network: Network): boolean;
}
//# sourceMappingURL=etherspot.d.ts.map