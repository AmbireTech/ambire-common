"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractNamesController = exports.PERSIST_FAILED_IN_MS = exports.PERSIST_NOT_FOUND_IN_MS = void 0;
exports.isUnderstandableName = isUnderstandableName;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
exports.PERSIST_NOT_FOUND_IN_MS = 1000 * 60 * 60; // 60 minutes
exports.PERSIST_FAILED_IN_MS = 1000 * 60 * 2; // 2 minutes
function isUnderstandableName(name) {
    const forbiddenWords = ['Ambire', 'Identity', 'Safe', 'Proxy', 'Diamond'];
    if (name.endsWith('able'))
        return false;
    if (forbiddenWords.some((fw) => name.toLowerCase().includes(fw.toLowerCase())))
        return false;
    return true;
}
/**
 * Contract Names controller - responsible for handling the lookup of address names.
 * Resolved names are saved in `contractNames` permanently, unless the lookup failed, then new
 * attempt will be made only after PERSIST_NOT_FOUND_IN_MS to avoid unnecessary lookups.
 */
class ContractNamesController extends eventEmitter_1.default {
    #debounceTime;
    #fetch;
    #lastTimeScheduledFetch = 0;
    #contractNames = {};
    #contractsPendingToBeFetched = [];
    constructor({ eventEmitterRegistry, fetch, debounceTime = 100 }) {
        super(eventEmitterRegistry);
        this.#fetch = fetch;
        this.#debounceTime = debounceTime;
    }
    get contractNames() {
        const toReturn = Object.entries(this.#contractNames).map(([address, v]) => {
            if (!v.name)
                return [address, v];
            if (isUnderstandableName(v.name))
                return [address, v];
            return [address, { ...v, name: undefined }];
        });
        return Object.fromEntries(toReturn);
    }
    get contractsPendingToBeFetched() {
        return this.#contractsPendingToBeFetched;
    }
    async #batchFetchNames() {
        // using a second variable to avoid race conditions in `contractsPendingToBeFetched`
        const contractsToFetch = this.#contractsPendingToBeFetched;
        this.#contractsPendingToBeFetched = [];
        this.emitUpdate();
        const url = `https://cena.ambire.com/api/v3/contracts/multiple?addresses=${contractsToFetch.map(({ address }) => address)}&chainIds=${contractsToFetch.map(({ chainId }) => chainId)}`;
        let failed = false;
        const res = await this.#fetch(url)
            .then((r) => r.json())
            .catch((e) => {
            failed = true;
            this.emitError({
                message: 'Failed to get names of addresses because the request to the relayer failed.',
                level: 'silent',
                sendCrashReport: true,
                error: e
            });
            contractsToFetch.forEach(({ address }) => {
                this.#contractNames[address] = {
                    address,
                    name: null,
                    error: 'Request to relayer failed',
                    isLoading: false,
                    updatedAt: Date.now(),
                    retryAfter: exports.PERSIST_FAILED_IN_MS
                };
            });
            // this is just to keep the type safety in case of changes
            return { error: e.message };
        });
        if (failed) {
            this.emitUpdate();
            return;
        }
        if ('error' in res) {
            this.emitError({
                message: 'Failed to get names of addresses because the request to the relayer failed.',
                level: 'silent',
                sendCrashReport: true,
                error: new Error(res.error)
            });
            contractsToFetch.forEach(({ address }) => {
                this.#contractNames[address] = {
                    address,
                    name: null,
                    error: 'Request to relayer failed',
                    isLoading: false,
                    updatedAt: Date.now(),
                    retryAfter: exports.PERSIST_FAILED_IN_MS
                };
            });
            this.emitUpdate();
            return;
        }
        contractsToFetch.forEach(({ address }) => {
            const foundData = res.contracts?.[address];
            this.#contractNames[address] = foundData?.name
                ? {
                    address,
                    name: foundData.name,
                    isLoading: false,
                    updatedAt: Date.now()
                }
                : {
                    address,
                    name: null,
                    error: 'Contract name not found',
                    isLoading: false,
                    updatedAt: Date.now(),
                    retryAfter: exports.PERSIST_NOT_FOUND_IN_MS
                };
        });
        this.emitUpdate();
    }
    #shouldSkipGetName(address, chainId) {
        const entry = this.#contractNames[address];
        if (!entry)
            return false;
        if (entry.name)
            return true;
        if (entry.isLoading)
            return true;
        if (this.#contractsPendingToBeFetched.some((p) => p.address === address && p.chainId === chainId)) {
            return true;
        }
        if (entry.updatedAt && entry.retryAfter) {
            const nextAllowedFetch = entry.updatedAt + entry.retryAfter;
            if (Date.now() < nextAllowedFetch)
                return true;
        }
        return false;
    }
    getName(_address, chainId) {
        if (!(0, ethers_1.isAddress)(_address))
            return this.emitError({
                message: 'Non address passed to ContractNamesController.getName',
                level: 'silent',
                sendCrashReport: true,
                error: new Error(`Non-address passed to ContractNamesController.getName: ${_address}, ${chainId}`)
            });
        const address = (0, ethers_1.getAddress)(_address);
        if (this.#shouldSkipGetName(address, chainId))
            return;
        this.#contractsPendingToBeFetched.push({ address, chainId });
        if (this.#contractNames[address]) {
            this.#contractNames[address].isLoading = true;
        }
        else {
            this.#contractNames[address] = { address, name: null, isLoading: true };
        }
        // if we already have recent fetch, do not add new one
        if (Date.now() - this.#lastTimeScheduledFetch < this.#debounceTime)
            return;
        this.#lastTimeScheduledFetch = Date.now();
        (0, wait_1.default)(this.#debounceTime)
            .then(() => this.#batchFetchNames())
            .catch((e) => {
            this.emitError({
                message: 'Failed to fetch address name',
                level: 'silent',
                sendCrashReport: true,
                error: e
            });
        });
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            contractNames: this.contractNames
        };
    }
}
exports.ContractNamesController = ContractNamesController;
//# sourceMappingURL=contractNames.js.map