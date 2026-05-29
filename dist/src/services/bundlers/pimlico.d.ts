import { RPCProvider } from '@/interfaces/provider';
import { BUNDLER } from '../../consts/bundlers';
import { Network } from '../../interfaces/network';
import { Bundler } from './bundler';
import { GasSpeeds, UserOpStatus } from './types';
export declare class Pimlico extends Bundler {
    protected getUrl(network: Network): string;
    /**
     * Pimlico has a second API url used for fallback purposes that skips
     * cloudflare. We will use it as a fallback to retry automatically
     * when the original URL fails
     */
    protected getFallbackProvider(network: Network): RPCProvider;
    protected getGasPrice(network: Network): Promise<GasSpeeds>;
    getStatus(network: Network, userOpHash: string): Promise<UserOpStatus>;
    getName(): BUNDLER;
    shouldReestimateBeforeBroadcast(): boolean;
}
//# sourceMappingURL=pimlico.d.ts.map