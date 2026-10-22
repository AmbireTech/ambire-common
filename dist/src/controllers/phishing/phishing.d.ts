import { RecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout';
import { IAddressBookController } from '../../interfaces/addressBook';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Fetch } from '../../interfaces/fetch';
import { BlacklistedStatus, IPhishingController } from '../../interfaces/phishing';
import { IStorageController } from '../../interfaces/storage';
import { IUiController } from '../../interfaces/ui';
import EventEmitter from '../eventEmitter/eventEmitter';
/**
 * Whether the user may mark the dApp at `url` as trusted, silencing the suspicious-hosting warning
 * for it. True only for a dApp on its own subdomain of a platform that hands out one per app: the
 * hostname is then a boundary the browser enforces, so the trust cannot reach anything else
 * published on the platform.
 */
export declare function canBeTrustedByUser(url: string): boolean;
export declare class PhishingController extends EventEmitter implements IPhishingController {
    #private;
    get updatePhishingInterval(): RecurringTimeout;
    get shouldSyncDapps(): boolean;
    resetShouldSyncDapps(): void;
    initialLoadPromise?: Promise<void>;
    isReady: boolean;
    constructor({ eventEmitterRegistry, fetch, storage, addressBook, ui, featureFlags }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        fetch: Fetch;
        storage: IStorageController;
        addressBook: IAddressBookController;
        ui: IUiController;
        featureFlags: IFeatureFlagsController;
    });
    /**
     * Not called immediately on construction because the data in storage is huge and overwhelming
     * for the mobile app.
     */
    init(): Promise<void>;
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
    /**
     * Resolves the blacklisted status of an address from the locally stored phishing list, without a
     * network request. Returns undefined while the list is not loaded yet, so that callers can tell
     * "not blacklisted" apart from "not checked yet".
     */
    getAddressBlacklistedStatus(address: string): BlacklistedStatus | undefined;
    toJSON(): this & {
        updatePhishingInterval: RecurringTimeout;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=phishing.d.ts.map