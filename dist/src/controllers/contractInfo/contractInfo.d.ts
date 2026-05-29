import { IContractInfoController, Selectors } from '@/interfaces/contractInfo';
import { IEventEmitterRegistryController } from '@/interfaces/eventEmitter';
import { IFeatureFlagsController } from '@/interfaces/featureFlags';
import { Fetch } from '@/interfaces/fetch';
import { IStorageController } from '@/interfaces/storage';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare const FUNCTION_SELECTORS_STORAGE_KEY = "functionSelectors";
export declare const SELECTOR_SUCCESS_DEADLINE_MS: number;
export declare const SELECTOR_NOT_FOUND_DEADLINE_MS: number;
export declare const SELECTOR_LOADING_DEADLINE: number;
export declare const SELECTOR_ERROR_DEADLINE_MS: number;
export declare class ContractInfoController extends EventEmitter implements IContractInfoController {
    #private;
    selectors: Selectors;
    initialLoadPromise?: Promise<void>;
    constructor({ eventEmitterRegistry, fetch, storage, featureFlags, cenaUrl }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        fetch: Fetch;
        storage: IStorageController;
        featureFlags: IFeatureFlagsController;
        cenaUrl?: string;
    });
    get isReady(): boolean;
    getSelector(selector: string): Promise<void>;
    toJSON(): this & {
        isReady: boolean;
        name: string;
        emittedErrors: import("@/interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=contractInfo.d.ts.map