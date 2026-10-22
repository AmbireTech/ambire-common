"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractInfoController = exports.SELECTOR_LOADING_DEADLINE_MS = exports.SELECTOR_RETRY_FETCH_TIMEOUT_MS = exports.SELECTOR_FIRST_FETCH_TIMEOUT_MS = exports.SELECTOR_FETCH_DEBOUNCE_MS = exports.SELECTOR_ERROR_DEADLINE_MS = exports.SELECTOR_NOT_FOUND_DEADLINE_MS = exports.SELECTOR_SUCCESS_DEADLINE_MS = exports.FUNCTION_SELECTORS_STORAGE_KEY = void 0;
const tslib_1 = require("tslib");
const decodeCall_1 = require("../../libs/decodeCall");
const fetch_1 = require("../../utils/fetch");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
exports.FUNCTION_SELECTORS_STORAGE_KEY = 'functionSelectors';
exports.SELECTOR_SUCCESS_DEADLINE_MS = 30 * 24 * 60 * 60 * 1000;
exports.SELECTOR_NOT_FOUND_DEADLINE_MS = exports.SELECTOR_SUCCESS_DEADLINE_MS;
exports.SELECTOR_ERROR_DEADLINE_MS = 5 * 60 * 1000;
exports.SELECTOR_FETCH_DEBOUNCE_MS = 100;
exports.SELECTOR_FIRST_FETCH_TIMEOUT_MS = 3 * 1000;
exports.SELECTOR_RETRY_FETCH_TIMEOUT_MS = 10 * 1000;
/** How long a call is shown as loading while its selectors are fetched, before giving up on it. */
exports.SELECTOR_LOADING_DEADLINE_MS = 5 * 1000;
// The ContractInfoController is responsible for getting function selectors for contracts
class ContractInfoController extends eventEmitter_1.default {
    #fetch;
    #storage;
    #featureFlag;
    #ui;
    #cenaUrl;
    #selectors = {};
    #queuedSelectors = new Set();
    #queuedBatchPromise;
    // The batch each queued or in flight selector belongs to, so that asking for it again
    // waits on that batch instead of fetching it twice
    #selectorBatchPromises = new Map();
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    constructor({ eventEmitterRegistry, fetch, storage, featureFlags, ui, cenaUrl = 'https://cena.ambire.com' }) {
        super(eventEmitterRegistry);
        this.#fetch = fetch;
        this.#storage = storage;
        this.#featureFlag = featureFlags;
        this.#ui = ui;
        this.#cenaUrl = cenaUrl;
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    async #load() {
        this.#selectors = await this.#storage.get(exports.FUNCTION_SELECTORS_STORAGE_KEY, {});
    }
    async #storeSelectorsInStorage() {
        await this.#storage.set(exports.FUNCTION_SELECTORS_STORAGE_KEY, this.#selectors);
    }
    #isOld(status, updatedAt) {
        const timeSinceUpdate = Date.now() - updatedAt;
        if (status === 'success' && timeSinceUpdate > exports.SELECTOR_SUCCESS_DEADLINE_MS)
            return true;
        if (status === 'error' && timeSinceUpdate > exports.SELECTOR_ERROR_DEADLINE_MS)
            return true;
        if (status === 'not-found' && timeSinceUpdate > exports.SELECTOR_NOT_FOUND_DEADLINE_MS)
            return true;
        return false;
    }
    #shouldFetch(selector) {
        if (!this.#featureFlag.isFeatureEnabled('apiForFunctionSelectors'))
            return false;
        const savedSelector = this.#selectors[selector];
        return !savedSelector || this.#isOld(savedSelector.status, savedSelector.updatedAt);
    }
    #getSignatures(selector) {
        const savedSelector = this.#selectors[selector];
        if (!savedSelector || !('data' in savedSelector) || !savedSelector.data)
            return [];
        return savedSelector.data;
    }
    async #attemptToFetchAndSet(selectorsToFetch, timeout) {
        let success = false;
        try {
            // send only part of the selectors just so we do not reveal the whole thing to the backend
            // for privacy reasons
            const joinPrivateSelectors = [...new Set(selectorsToFetch.map((s) => s.slice(0, 6)))].join(',');
            const cenaUrl = `${this.#cenaUrl}/api/v3/contracts/selectors?selectors=${joinPrivateSelectors}`;
            const result = await (0, fetch_1.fetchWithTimeout)(this.#fetch, cenaUrl, {}, timeout).then((r) => r.json());
            if (!result.success)
                throw new Error('Failed to fetch contract selectors');
            if (!result.data ||
                typeof result.data !== 'object' ||
                !Object.values(result.data).every((signatures) => Array.isArray(signatures) && signatures.every((s) => typeof s === 'string')))
                throw new Error('Wrong format for contract selectors');
            const deduplicatedSelectors = [...new Set([...selectorsToFetch, ...Object.keys(result.data)])];
            deduplicatedSelectors.forEach((selector) => {
                const signatures = result.data[selector];
                const mappedFoundSignatures = (signatures || []).map((s) => ({ signature: s }));
                if (mappedFoundSignatures.length)
                    this.#selectors[selector] = {
                        data: mappedFoundSignatures,
                        status: 'success',
                        updatedAt: Date.now()
                    };
                else
                    this.#selectors[selector] = { status: 'not-found', updatedAt: Date.now() };
            });
            success = true;
        }
        catch (e) {
            this.emitError({
                error: e,
                level: 'silent',
                message: 'Failed to fetch contract selectors',
                sendCrashReport: true
            });
            selectorsToFetch.forEach((s) => {
                const oldData = this.#selectors[s] && 'data' in this.#selectors[s] ? this.#selectors[s].data : undefined;
                this.#selectors[s] = {
                    status: 'error',
                    data: oldData,
                    error: e.message,
                    updatedAt: Date.now()
                };
            });
        }
        void this.#storeSelectorsInStorage();
        return success;
    }
    async #fetchQueuedSelectors() {
        const selectorsToFetch = [...this.#queuedSelectors];
        this.#queuedSelectors.clear();
        // Selectors asked for while this batch is in flight start the next batch
        this.#queuedBatchPromise = undefined;
        try {
            const isFirstTryOk = await this.#attemptToFetchAndSet(selectorsToFetch, exports.SELECTOR_FIRST_FETCH_TIMEOUT_MS);
            if (!isFirstTryOk) {
                console.error('Failed to fetch contract selectors on first try');
                await this.#attemptToFetchAndSet(selectorsToFetch, exports.SELECTOR_RETRY_FETCH_TIMEOUT_MS);
            }
        }
        finally {
            selectorsToFetch.forEach((selector) => this.#selectorBatchPromises.delete(selector));
        }
    }
    #queueSelector(selector) {
        this.#queuedSelectors.add(selector);
        if (!this.#queuedBatchPromise) {
            this.#queuedBatchPromise = (0, wait_1.default)(exports.SELECTOR_FETCH_DEBOUNCE_MS).then(() => this.#fetchQueuedSelectors());
        }
        this.#selectorBatchPromises.set(selector, this.#queuedBatchPromise);
        return this.#queuedBatchPromise;
    }
    /**
     * Decodes call data from the saved selectors, without fetching anything. Returns the decoded
     * call, or null when it can't be decoded.
     */
    decodeCallData(data) {
        return (0, decodeCall_1.decodeCallDataRecursively)(data, (selector) => this.#getSignatures(selector)).decodedCall;
    }
    #getMissingSelectors(datas) {
        const selectors = datas.flatMap((data) => (0, decodeCall_1.decodeCallDataRecursively)(data, (selector) => this.#getSignatures(selector)).selectors);
        return [...new Set(selectors)].filter((selector) => this.#shouldFetch(selector));
    }
    /**
     * Fetches the given selectors that were never fetched or have expired. Selectors asked for
     * close together share one request, and one that is already being fetched is not asked for
     * again. Resolves once each of them is saved, found or not, and never rejects, since a failed
     * fetch is saved as an error.
     */
    async fetchSelectors(selectors) {
        await this.initialLoadPromise;
        const batchPromises = new Set();
        selectors.forEach((selector) => {
            const pendingBatchPromise = this.#selectorBatchPromises.get(selector);
            if (pendingBatchPromise) {
                batchPromises.add(pendingBatchPromise);
                return;
            }
            if (!this.#shouldFetch(selector))
                return;
            batchPromises.add(this.#queueSelector(selector));
        });
        await Promise.all(batchPromises);
    }
    /**
     * Fetches every selector needed to decode the given call datas, including the ones of nested
     * call data that only shows up once its parent is decoded. Selectors already being fetched are
     * waited on instead of asked for again. Resolves once each of them is saved, found or not, and
     * never rejects, since a failed fetch is saved as an error.
     */
    async fetchSelectorsForCallDatas(datas) {
        await this.initialLoadPromise;
        // Each selector is fetched at most once per call, so the loop ends even if one isn't saved
        const attemptedSelectors = new Set();
        let selectorsToFetch = this.#getMissingSelectors(datas);
        while (selectorsToFetch.length) {
            selectorsToFetch.forEach((selector) => attemptedSelectors.add(selector));
            await this.fetchSelectors(selectorsToFetch);
            selectorsToFetch = this.#getMissingSelectors(datas).filter((selector) => !attemptedSelectors.has(selector));
        }
    }
    /**
     * Decodes each call data from the saved selectors and replies to the UI request with the
     * decoded calls in the same order, null for the ones that can't be decoded. Nothing is fetched.
     */
    async decodeCallsForUi(datas, requestId) {
        await this.initialLoadPromise;
        const decodedCalls = datas.map((data) => this.decodeCallData(data));
        this.#ui.message.sendUiMessage({ requestId, ok: true, res: decodedCalls });
    }
}
exports.ContractInfoController = ContractInfoController;
//# sourceMappingURL=contractInfo.js.map