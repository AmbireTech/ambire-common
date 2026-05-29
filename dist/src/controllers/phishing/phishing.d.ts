import { RecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout';
import { IAddressBookController } from '../../interfaces/addressBook';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { Fetch } from '../../interfaces/fetch';
import { BlacklistedStatus, IPhishingController } from '../../interfaces/phishing';
import { IStorageController } from '../../interfaces/storage';
import { IUiController } from '../../interfaces/ui';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare class PhishingController extends EventEmitter implements IPhishingController {
    #private;
    get updatePhishingInterval(): RecurringTimeout;
    get shouldSyncDapps(): boolean;
    resetShouldSyncDapps(): void;
    initialLoadPromise?: Promise<void>;
    constructor({ eventEmitterRegistry, fetch, storage, addressBook, ui }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        fetch: Fetch;
        storage: IStorageController;
        addressBook: IAddressBookController;
        ui: IUiController;
    });
    /**
     * Wrapper around #continuouslyUpdatePhishing that:
     * 1) deduplicates concurrent triggers via a shared promise
     * 2) switches to the failed-retry interval when the fetch/update flow throws
     */
    continuouslyUpdatePhishing(): Promise<void>;
    updateDomainsBlacklistedStatus(urls: string[], callback: (res: {
        [dappId: string]: BlacklistedStatus;
    }) => void): Promise<void>;
    updateAddressesBlacklistedStatus(urls: string[], callback: (res: {
        [dappId: string]: BlacklistedStatus;
    }) => void): Promise<void>;
    getDomainBlacklistedStatus(url: string): BlacklistedStatus | undefined;
    toJSON(): this & {
        updatePhishingInterval: RecurringTimeout;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=phishing.d.ts.map