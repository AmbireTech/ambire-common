import { Account } from '../../interfaces/account';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { Fetch } from '../../interfaces/fetch';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { INetworksController, Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { VerificationStatuses } from '../../interfaces/verification';
import { GetOptions } from '../../libs/portfolio';
import { PortfolioLibGetResult, PortfolioVerification, TokenDataCache } from '../../libs/portfolio/interfaces';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare const COLIBRI_CATCH_UP_RETRY_INTERVAL = 3000;
export declare const COLIBRI_CATCH_UP_RETRIES = 5;
export type VerifyPortfolioParams = {
    account: Account;
    network: Network;
    rpcResult: PortfolioLibGetResult;
    getOptions: Partial<GetOptions>;
    tokenDataCache: TokenDataCache;
};
export declare class VerificationController extends EventEmitter {
    #private;
    initialLoadPromise?: Promise<void>;
    statusesByChainId: VerificationStatuses;
    constructor({ eventEmitterRegistry, networks, fetch, velcroUrl, featureFlags }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        networks: INetworksController;
        fetch: Fetch;
        velcroUrl: string;
        featureFlags?: IFeatureFlagsController;
    });
    getReadyProvider(chainId: Network['chainId']): RPCProvider | null;
    /**
     * Cryptographically verify an already-fetched RPC portfolio result against Colibri.
     *
     * This runs off the portfolio's critical path (the balances are already shown
     * by the time this is called). Because Colibri can prove state for any block up
     * to its head, we verify at the exact block the RPC used (`rpcResult.blockNumber`)
     * instead of coordinating a shared block before fetching. The head gap only
     * decides whether a fresh, comparable result is possible at all:
     * - RPC far behind Colibri -> `stale` (the shown balances are old)
     * - Colibri far behind the RPC -> `warning` (cannot verify)
     * - Colibri slightly behind the RPC -> wait briefly for Colibri to catch up,
     *   then verify or report a warning
     */
    verifyPortfolio(params: VerifyPortfolioParams): Promise<PortfolioVerification>;
    updateNetworks(networks: Network[]): void;
    init({ networks }: {
        networks: Network[];
    }): void;
}
//# sourceMappingURL=verification.d.ts.map