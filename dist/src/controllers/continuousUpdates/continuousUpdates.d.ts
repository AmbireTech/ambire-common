import { IRecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IMainController } from '../../interfaces/main';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare class ContinuousUpdatesController extends EventEmitter {
    #private;
    get updatePortfolioInterval(): IRecurringTimeout;
    get accountsOpsStatusesInterval(): IRecurringTimeout;
    get accountStateLatestInterval(): IRecurringTimeout;
    get fastAccountStateReFetchTimeout(): IRecurringTimeout;
    initialLoadPromise?: Promise<void> | undefined;
    constructor({ eventEmitterRegistry, main }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        main: IMainController;
    });
}
//# sourceMappingURL=continuousUpdates.d.ts.map