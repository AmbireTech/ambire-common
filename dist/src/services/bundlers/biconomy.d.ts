import { Network } from 'interfaces/network';
import { BUNDLER } from '../../consts/bundlers';
import { Bundler } from './bundler';
import { GasSpeeds, UserOpStatus } from './types';
export declare class Biconomy extends Bundler {
    protected getUrl(network: Network): string;
    protected getGasPrice(network: Network): Promise<GasSpeeds>;
    getStatus(network: Network, userOpHash: string): Promise<UserOpStatus>;
    getName(): BUNDLER;
}
//# sourceMappingURL=biconomy.d.ts.map