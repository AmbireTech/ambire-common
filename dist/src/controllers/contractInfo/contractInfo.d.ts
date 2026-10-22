import { IContractInfoController } from '../../interfaces/contractInfo';
import { DecodedCall } from '../../interfaces/decodeCall';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Fetch } from '../../interfaces/fetch';
import { IStorageController } from '../../interfaces/storage';
import { IUiController } from '../../interfaces/ui';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare const FUNCTION_SELECTORS_STORAGE_KEY = "functionSelectors";
export declare const SELECTOR_SUCCESS_DEADLINE_MS: number;
export declare const SELECTOR_NOT_FOUND_DEADLINE_MS: number;
export declare const SELECTOR_ERROR_DEADLINE_MS: number;
export declare const SELECTOR_FETCH_DEBOUNCE_MS = 100;
export declare const SELECTOR_FIRST_FETCH_TIMEOUT_MS: number;
export declare const SELECTOR_RETRY_FETCH_TIMEOUT_MS: number;
/** How long a call is shown as loading while its selectors are fetched, before giving up on it. */
export declare const SELECTOR_LOADING_DEADLINE_MS: number;
export declare class ContractInfoController extends EventEmitter implements IContractInfoController {
    #private;
    initialLoadPromise?: Promise<void>;
    constructor({ eventEmitterRegistry, fetch, storage, featureFlags, ui, cenaUrl }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        fetch: Fetch;
        storage: IStorageController;
        featureFlags: IFeatureFlagsController;
        ui: IUiController;
        cenaUrl?: string;
    });
    /**
     * Decodes call data from the saved selectors, without fetching anything. Returns the decoded
     * call, or null when it can't be decoded.
     */
    decodeCallData(data: string): DecodedCall | null;
    /**
     * Fetches the given selectors that were never fetched or have expired. Selectors asked for
     * close together share one request, and one that is already being fetched is not asked for
     * again. Resolves once each of them is saved, found or not, and never rejects, since a failed
     * fetch is saved as an error.
     */
    fetchSelectors(selectors: string[]): Promise<void>;
    /**
     * Fetches every selector needed to decode the given call datas, including the ones of nested
     * call data that only shows up once its parent is decoded. Selectors already being fetched are
     * waited on instead of asked for again. Resolves once each of them is saved, found or not, and
     * never rejects, since a failed fetch is saved as an error.
     */
    fetchSelectorsForCallDatas(datas: string[]): Promise<void>;
    /**
     * Decodes each call data from the saved selectors and replies to the UI request with the
     * decoded calls in the same order, null for the ones that can't be decoded. Nothing is fetched.
     */
    decodeCallsForUi(datas: string[], requestId: string): Promise<void>;
}
//# sourceMappingURL=contractInfo.d.ts.map