"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhishingController = exports.matchPartsAgainstList = exports.domainToParts = void 0;
const tslib_1 = require("tslib");
const js_yaml_1 = tslib_1.__importDefault(require("js-yaml"));
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const METAMASK_BLACKLIST_URL = 'https://api.github.com/repos/MetaMask/eth-phishing-detect/contents/src/config.json?ref=main';
const PHANTOM_BLACKLIST_URL = 'https://api.github.com/repos/phantom/blocklist/contents/blocklist.yaml?ref=master';
const domainToParts = (domain) => {
    try {
        return domain.split('.').reverse();
    }
    catch (e) {
        throw new Error(JSON.stringify(domain));
    }
};
exports.domainToParts = domainToParts;
const matchPartsAgainstList = (source, list) => {
    return list.find((domain) => {
        const target = (0, exports.domainToParts)(domain);
        // target domain has more parts than source, fail
        if (target.length > source.length)
            return false;
        // source matches target or (is deeper subdomain)
        return target.every((part, index) => source[index] === part);
    });
};
exports.matchPartsAgainstList = matchPartsAgainstList;
class PhishingController extends eventEmitter_1.default {
    #fetch;
    #storage;
    #windowManager;
    #blacklist = []; // list of blacklisted URLs
    #lastStorageUpdate = null;
    updateStatus = 'INITIAL';
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    get lastStorageUpdate() {
        return this.#lastStorageUpdate;
    }
    get blacklistLength() {
        return this.#blacklist.length;
    }
    constructor({ fetch, storage, windowManager }) {
        super();
        this.#fetch = fetch;
        this.#storage = storage;
        this.#windowManager = windowManager;
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.initialLoadPromise = this.#load();
    }
    async #load() {
        const storedPhishingDetection = await this.#storage.get('phishingDetection', null);
        if (storedPhishingDetection) {
            this.#blacklist = Array.from(new Set([
                ...storedPhishingDetection.metamaskBlacklist,
                ...storedPhishingDetection.phantomBlacklist
            ]));
        }
        await this.#update(storedPhishingDetection);
    }
    async #update(storedPhishingDetection) {
        this.updateStatus = 'LOADING';
        this.emitUpdate();
        const headers = {
            Accept: 'application/vnd.github.v3.+json'
        };
        const results = await Promise.allSettled([
            this.#fetch(METAMASK_BLACKLIST_URL, headers)
                .then((res) => res.json())
                .then((metadata) => fetch(metadata.download_url))
                .then((rawRes) => rawRes.json())
                .then((data) => data.blacklist)
                .catch(() => []),
            this.#fetch(PHANTOM_BLACKLIST_URL, headers)
                .then((res) => res.json())
                .then((metadata) => fetch(metadata.download_url))
                .then((res) => res.text())
                .then((text) => js_yaml_1.default.load(text))
                .then((data) => (data && data.length ? data.map((i) => i.url) : []))
                .catch(() => [])
        ]);
        let [metamaskBlacklist, phantomBlacklist] = results.map((result) => result.status === 'fulfilled' ? result.value || [] : []);
        if (metamaskBlacklist.length && phantomBlacklist.length) {
            const timestamp = Date.now();
            await this.#storage.set('phishingDetection', {
                timestamp,
                metamaskBlacklist: metamaskBlacklist || [],
                phantomBlacklist: phantomBlacklist || []
            });
            this.#lastStorageUpdate = timestamp;
        }
        else if (storedPhishingDetection && !this.#lastStorageUpdate) {
            this.#lastStorageUpdate = storedPhishingDetection.timestamp;
        }
        if (storedPhishingDetection) {
            metamaskBlacklist = metamaskBlacklist.length
                ? metamaskBlacklist
                : storedPhishingDetection.metamaskBlacklist;
            phantomBlacklist = phantomBlacklist.length
                ? phantomBlacklist
                : storedPhishingDetection.phantomBlacklist;
        }
        this.#blacklist = Array.from(new Set([...metamaskBlacklist, ...phantomBlacklist]));
        this.updateStatus = 'INITIAL';
        this.emitUpdate();
    }
    async updateIfNeeded() {
        if (this.updateStatus === 'LOADING')
            return;
        const sixHoursInMs = 6 * 60 * 60 * 1000;
        if (this.#lastStorageUpdate && Date.now() - this.#lastStorageUpdate < sixHoursInMs)
            return;
        const storedPhishingDetection = await this.#storage.get('phishingDetection', null);
        if (!storedPhishingDetection)
            return;
        if (Date.now() - storedPhishingDetection.timestamp >= sixHoursInMs) {
            await this.#update(storedPhishingDetection);
        }
    }
    async getIsBlacklisted(url) {
        await this.initialLoadPromise;
        try {
            const hostname = new URL(url).hostname;
            const domain = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
            // blacklisted if it has `ambire` in the hostname but it is not a pre-approved ambire domain
            if (/ambire/i.test(domain) && !/\.?ambire\.com$/.test(domain)) {
                return true;
            }
            const source = (0, exports.domainToParts)(domain);
            return !!(0, exports.matchPartsAgainstList)(source, this.#blacklist);
        }
        catch (error) {
            return false;
        }
    }
    async sendIsBlacklistedToUi(url) {
        await this.initialLoadPromise;
        const isBlacklisted = await this.getIsBlacklisted(url);
        this.#windowManager.sendWindowUiMessage({
            hostname: isBlacklisted ? 'BLACKLISTED' : 'NOT_BLACKLISTED'
        });
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            lastStorageUpdate: this.lastStorageUpdate,
            blacklistLength: this.blacklistLength
        };
    }
}
exports.PhishingController = PhishingController;
//# sourceMappingURL=phishing.js.map