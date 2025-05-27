import { Fetch } from '../../interfaces/fetch';
import { WindowManager } from '../../interfaces/window';
import EventEmitter from '../eventEmitter/eventEmitter';
import { StorageController } from '../storage/storage';
export type StoredPhishingDetection = {
    timestamp: number;
    metamaskBlacklist: string[];
    phantomBlacklist: string[];
} | null;
export declare const domainToParts: (domain: string) => string[];
export declare const matchPartsAgainstList: (source: string[], list: string[]) => string | undefined;
export declare class PhishingController extends EventEmitter {
    #private;
    updateStatus: 'LOADING' | 'INITIAL';
    initialLoadPromise: Promise<void>;
    get lastStorageUpdate(): number | null;
    get blacklistLength(): number;
    constructor({ fetch, storage, windowManager }: {
        fetch: Fetch;
        storage: StorageController;
        windowManager: WindowManager;
    });
    updateIfNeeded(): Promise<void>;
    getIsBlacklisted(url: string): Promise<boolean>;
    sendIsBlacklistedToUi(url: string): Promise<void>;
    toJSON(): this & {
        lastStorageUpdate: number | null;
        blacklistLength: number;
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=phishing.d.ts.map