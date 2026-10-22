import { IRecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IMainController } from '../../interfaces/main';
import EventEmitter from '../eventEmitter/eventEmitter';
/** How many consecutive failed trending tokens fetches are retried at the fast failed-retry
cadence before falling back to the normal one, so a long API outage isn't retried every minute. */
export declare const MAX_TRENDING_TOKENS_FAILED_RETRIES = 5;
export declare class ContinuousUpdatesController extends EventEmitter {
    #private;
    get updatePortfolioInterval(): IRecurringTimeout;
    get accountsOpsStatusesInterval(): IRecurringTimeout;
    restartAccountsOpsStatusesInterval({ runImmediately }?: {
        runImmediately?: boolean;
    }): void;
    get accountStateLatestInterval(): IRecurringTimeout;
    get fastAccountStateReFetchTimeout(): IRecurringTimeout;
    get updateTrendingTokensInterval(): IRecurringTimeout;
    initialLoadPromise?: Promise<void> | undefined;
    constructor({ eventEmitterRegistry, main }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        main: IMainController;
    });
}
//# sourceMappingURL=continuousUpdates.d.ts.map