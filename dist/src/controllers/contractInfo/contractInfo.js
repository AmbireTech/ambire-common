"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractInfoController = exports.SELECTOR_ERROR_DEADLINE_MS = exports.SELECTOR_LOADING_DEADLINE = exports.SELECTOR_NOT_FOUND_DEADLINE_MS = exports.SELECTOR_SUCCESS_DEADLINE_MS = exports.FUNCTION_SELECTORS_STORAGE_KEY = void 0;
const tslib_1 = require("tslib");
const fetch_1 = require("../../utils/fetch");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
exports.FUNCTION_SELECTORS_STORAGE_KEY = 'functionSelectors';
exports.SELECTOR_SUCCESS_DEADLINE_MS = 30 * 24 * 60 * 60 * 1000;
exports.SELECTOR_NOT_FOUND_DEADLINE_MS = exports.SELECTOR_SUCCESS_DEADLINE_MS;
exports.SELECTOR_LOADING_DEADLINE = 1000 * 5;
exports.SELECTOR_ERROR_DEADLINE_MS = 5 * 60 * 1000;
// The ContractInfoController is responsible for getting function selectors for contracts
class ContractInfoController extends eventEmitter_1.default {
    #fetch;
    #storage;
    #debounceBufferForSelectors = new Set();
    #debounceSelectorFetchPromise;
    #featureFlag;
    #cenaUrl;
    selectors = {};
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    constructor({ eventEmitterRegistry, fetch, storage, featureFlags, cenaUrl = 'https://cena.ambire.com' }) {
        super(eventEmitterRegistry);
        this.#fetch = fetch;
        this.#storage = storage;
        this.#featureFlag = featureFlags;
        this.#cenaUrl = cenaUrl;
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    get isReady() {
        return !this.initialLoadPromise;
    }
    async #load() {
        this.selectors = await this.#storage.get(exports.FUNCTION_SELECTORS_STORAGE_KEY, {});
        this.emitUpdate();
    }
    async #storeSelectorsInStorage() {
        const selectorsToStore = {};
        Object.entries(this.selectors).forEach(([k, v]) => {
            if (v.status === 'loading')
                return;
            selectorsToStore[k] = v;
        });
        await this.#storage.set(exports.FUNCTION_SELECTORS_STORAGE_KEY, selectorsToStore);
    }
    #isOld(status, updatedAt) {
        const timeSinceUpdate = Date.now() - updatedAt;
        if (status === 'success' && timeSinceUpdate > exports.SELECTOR_SUCCESS_DEADLINE_MS)
            return true;
        if (status === 'error' && timeSinceUpdate > exports.SELECTOR_ERROR_DEADLINE_MS)
            return true;
        if (status === 'not-found' && timeSinceUpdate > exports.SELECTOR_NOT_FOUND_DEADLINE_MS)
            return true;
        if (status === 'fetching-disabled' && timeSinceUpdate >= 0)
            return true;
        if (status === 'loading' && timeSinceUpdate > exports.SELECTOR_LOADING_DEADLINE)
            return true;
        return false;
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
                    this.selectors[selector] = {
                        data: mappedFoundSignatures,
                        status: 'success',
                        updatedAt: Date.now()
                    };
                else
                    this.selectors[selector] = { status: 'not-found', updatedAt: Date.now() };
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
                const oldData = this.selectors[s] && 'data' in this.selectors?.[s] ? this.selectors[s].data : undefined;
                this.selectors[s] = {
                    status: 'error',
                    data: oldData,
                    error: e.message,
                    updatedAt: Date.now()
                };
            });
        }
        this.emitUpdate();
        void this.#storeSelectorsInStorage();
        return success;
    }
    async #fetchBufferedSelectors() {
        await this.initialLoadPromise;
        const selectorsToFetch = [...this.#debounceBufferForSelectors].filter((s) => {
            return (!this.selectors[s] ||
                this.selectors[s].status === 'loading' ||
                this.#isOld(this.selectors[s].status, this.selectors[s].updatedAt));
        });
        this.#debounceBufferForSelectors.clear();
        if (!selectorsToFetch.length)
            return;
        const isFirstTryOk = await this.#attemptToFetchAndSet(selectorsToFetch, 3000);
        if (!isFirstTryOk) {
            console.error('Failed to fetch contract selectors on first try');
            await this.#attemptToFetchAndSet(selectorsToFetch, 10000);
        }
    }
    async getSelector(selector) {
        if (!this.#featureFlag.isFeatureEnabled('apiForFunctionSelectors')) {
            if (!this.selectors[selector])
                this.selectors[selector] = { status: 'fetching-disabled', updatedAt: Date.now() };
            this.emitUpdate();
            return;
        }
        const existing = this.selectors[selector];
        if (this.#debounceBufferForSelectors.has(selector))
            return;
        if (existing && !this.#isOld(existing.status, existing.updatedAt))
            return;
        this.#debounceBufferForSelectors.add(selector);
        const currentData = this.selectors[selector] && 'data' in this.selectors?.[selector]
            ? this.selectors[selector].data
            : undefined;
        this.selectors[selector] = { status: 'loading', data: currentData, updatedAt: Date.now() };
        this.emitUpdate();
        if (!this.#debounceSelectorFetchPromise) {
            this.#debounceSelectorFetchPromise = (0, wait_1.default)(100)
                .then(() => this.#fetchBufferedSelectors())
                .catch((e) => {
                console.error('The debounced this.#debounceSelectorFetchPromise failed', e);
            })
                .finally(() => {
                this.#debounceSelectorFetchPromise = undefined;
            });
        }
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            isReady: this.isReady
        };
    }
}
exports.ContractInfoController = ContractInfoController;
//# sourceMappingURL=contractInfo.js.map