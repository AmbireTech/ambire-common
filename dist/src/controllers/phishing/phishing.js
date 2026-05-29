import { getDomain } from 'tldts';
import { zeroAddress } from 'viem';
import { RecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout';
import { PHISHING_ACTIVE_UPDATE_INTERVAL, PHISHING_FAILED_TO_GET_UPDATE_INTERVAL, PHISHING_INACTIVE_UPDATE_INTERVAL } from '../../consts/intervals';
import { getDappIdFromUrl } from '../../libs/dapps/helpers';
import { fetchWithTimeout } from '../../utils/fetch';
import EventEmitter from '../eventEmitter/eventEmitter';
const SCAMCHECKER_BASE_URL = 'https://cena.ambire.com/api/v3/scamchecker';
const PHISHING_ACTIVE_VIEW_TYPES = new Set(['request-window', 'popup', 'tab']);
export class PhishingController extends EventEmitter {
    #fetch;
    #storage;
    #addressBook;
    #ui;
    #domains = new Set();
    #addresses = new Set();
    // Local versioning, used for requesting incremental phishing list updates.
    #version = 0;
    #updatedAt = null;
    #domainsBlacklistedStatus = new Map();
    #addressesBlacklistedStatus = new Map();
    #updatePhishingInterval;
    #shouldSyncDapps = false;
    #continuouslyUpdatePhishingPromise;
    get updatePhishingInterval() {
        return this.#updatePhishingInterval;
    }
    get shouldSyncDapps() {
        return this.#shouldSyncDapps;
    }
    resetShouldSyncDapps() {
        this.#shouldSyncDapps = false;
    }
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    constructor({ eventEmitterRegistry, fetch, storage, addressBook, ui }) {
        super(eventEmitterRegistry);
        this.#fetch = fetch;
        this.#storage = storage;
        this.#addressBook = addressBook;
        this.#ui = ui;
        this.#updatePhishingInterval = new RecurringTimeout(async () => this.continuouslyUpdatePhishing(), PHISHING_INACTIVE_UPDATE_INTERVAL, this.emitError.bind(this));
        this.#ui.uiEvent.on('addView', (view) => {
            const isActiveViewType = PHISHING_ACTIVE_VIEW_TYPES.has(view.type);
            const isAlreadyUsingActiveUpdateInterval = this.#updatePhishingInterval.currentTimeout === PHISHING_ACTIVE_UPDATE_INTERVAL;
            const shouldSwitchToActiveUpdateInterval = isActiveViewType && !isAlreadyUsingActiveUpdateInterval;
            if (shouldSwitchToActiveUpdateInterval)
                this.#updatePhishingInterval.restart({
                    timeout: PHISHING_ACTIVE_UPDATE_INTERVAL,
                    runImmediately: true
                });
        });
        this.#ui.uiEvent.on('removeView', () => {
            const hasAtLeastOneActiveViewOpen = this.#ui.views.some((view) => PHISHING_ACTIVE_VIEW_TYPES.has(view.type));
            const shouldSwitchToInactiveUpdateInterval = !hasAtLeastOneActiveViewOpen;
            if (shouldSwitchToInactiveUpdateInterval)
                this.#updatePhishingInterval.restart({ timeout: PHISHING_INACTIVE_UPDATE_INTERVAL });
        });
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    async #load() {
        const phishing = await this.#storage.get('phishing', {
            version: 0,
            updatedAt: 0,
            domains: [],
            addresses: []
        });
        this.#version = phishing.version;
        this.#updatedAt = phishing.updatedAt;
        this.#domains = new Set(phishing.domains);
        this.#addresses = new Set(phishing.addresses);
        this.updatePhishingInterval.start({ runImmediately: true });
        this.emitUpdate();
    }
    /**
     * Wrapper around #continuouslyUpdatePhishing that:
     * 1) deduplicates concurrent triggers via a shared promise
     * 2) switches to the failed-retry interval when the fetch/update flow throws
     */
    async continuouslyUpdatePhishing() {
        if (this.#continuouslyUpdatePhishingPromise) {
            await this.#continuouslyUpdatePhishingPromise;
            return;
        }
        this.#continuouslyUpdatePhishingPromise = this.#continuouslyUpdatePhishing()
            .catch((err) => {
            this.updatePhishingInterval.updateTimeout({
                timeout: PHISHING_FAILED_TO_GET_UPDATE_INTERVAL
            });
            throw err;
        })
            .finally(() => {
            this.#continuouslyUpdatePhishingPromise = undefined;
        });
        await this.#continuouslyUpdatePhishingPromise;
    }
    async #continuouslyUpdatePhishing() {
        // This prevents redundant requests to the relayer
        // when the extension reloads multiple times within a short period.
        const timeSinceLastUpdate = this.#updatedAt ? Date.now() - this.#updatedAt : null;
        if (this.#updatedAt &&
            timeSinceLastUpdate !== null &&
            timeSinceLastUpdate < this.updatePhishingInterval.currentTimeout) {
            // NOTE: used for debugging only
            // console.log(
            //   `[PhishingController] Skip update (sinceLastUpdate=${Math.floor(timeSinceLastUpdate / 1000)}s, timeout=${Math.floor(this.updatePhishingInterval.currentTimeout / 1000)}s)`
            // )
            return;
        }
        // NOTE: used for debugging only
        // console.log(
        //   `[PhishingController] Fetch update (version=${this.#version}, timeout=${Math.floor(this.updatePhishingInterval.currentTimeout / 1000)}s)`
        // )
        // version=0 means no local snapshot yet -> fetch full data.
        // version>0 means we have a checkpoint -> fetch only the delta since that version.
        const res = await fetchWithTimeout(this.#fetch, this.#version
            ? `${SCAMCHECKER_BASE_URL}/get_update?version=${this.#version}`
            : `${SCAMCHECKER_BASE_URL}/data`, {}, 60000);
        if (!res.ok || res.status !== 200) {
            throw new Error(`Failed to update phishing (status: ${res.status}, url: ${res.url})`);
        }
        const phishing = await res.json();
        if (this.#version) {
            // Incremental update: apply add/remove operations on top of local sets.
            this.#version = phishing.toVersion || 0;
            (phishing.domains || []).forEach(({ op, domain }) => {
                if (op === 'add')
                    this.#domains.add(domain);
                if (op === 'remove')
                    this.#domains.delete(domain);
            });
            (phishing.addresses || []).forEach(({ op, address }) => {
                if (op === 'add')
                    this.#addresses.add(address);
                if (op === 'remove')
                    this.#addresses.delete(address);
            });
        }
        else {
            // Initial/full update: replace local sets with the server snapshot.
            this.#version = phishing.version || 0;
            this.#domains = new Set(phishing.domains || []);
            this.#addresses = new Set(phishing.addresses || []);
        }
        this.#shouldSyncDapps = true;
        this.emitUpdate();
        const updatedAt = Date.now();
        this.#updatedAt = updatedAt;
        await this.#storage.set('phishing', {
            version: this.#version,
            updatedAt,
            domains: [...this.#domains],
            addresses: [...this.#addresses]
        });
        if (this.updatePhishingInterval.currentTimeout === PHISHING_FAILED_TO_GET_UPDATE_INTERVAL) {
            this.updatePhishingInterval.updateTimeout({ timeout: PHISHING_INACTIVE_UPDATE_INTERVAL });
        }
        // NOTE: used for debugging only
        // console.log(
        //   `[PhishingController] Update applied (version=${this.#version}, domains=${this.#domains.size}, addresses=${this.#addresses.size})`
        // )
    }
    /**
     * Takes a list of dapp domains and returns each with blacklist status.
     */
    async #fetchAndSetDomainsBlacklistedStatus(urls, callback) {
        if (!urls.length)
            return;
        const dappsData = urls.map((url) => ({ dappId: getDappIdFromUrl(url), url }));
        if (process.env.IS_TESTING === 'true') {
            dappsData.forEach(({ dappId }) => {
                this.#domainsBlacklistedStatus.set(dappId, this.#domainsBlacklistedStatus.get(dappId) || 'VERIFIED');
            });
            !!callback &&
                callback(Object.fromEntries(dappsData.map(({ dappId }) => [dappId, this.#domainsBlacklistedStatus.get(dappId)])));
            return;
        }
        dappsData.forEach(({ dappId }) => {
            const status = this.#domains.size
                ? this.#domains.has(dappId) || this.#domains.has(getDomain(dappId))
                    ? 'BLACKLISTED'
                    : 'VERIFIED'
                : undefined;
            if (status)
                this.#domainsBlacklistedStatus.set(dappId, status);
        });
        // Filter: we only fetch for ones that are missing or stale
        const dappsToFetch = dappsData.filter(({ dappId }) => {
            const status = this.#domainsBlacklistedStatus.get(dappId);
            if (!status)
                return true;
            if (['FAILED_TO_GET', 'LOADING'].includes(status))
                return true;
            return false;
        });
        // Mark only the ones we will fetch as LOADING
        dappsToFetch.forEach(({ dappId }) => {
            this.#domainsBlacklistedStatus.set(dappId, 'LOADING');
        });
        !!callback &&
            callback(Object.fromEntries(dappsData.map(({ dappId }) => [dappId, this.#domainsBlacklistedStatus.get(dappId)])));
        this.emitUpdate();
        if (!dappsToFetch.length)
            return; // there will be dappsToFetch only if this.#domains is still empty
        const res = await fetchWithTimeout(this.#fetch, `${SCAMCHECKER_BASE_URL}/domains`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domains: dappsToFetch.map(({ dappId }) => dappId) })
        }, dappsToFetch.length === 1 ? 5000 : 30000);
        if (!res.ok || res.status !== 200) {
            dappsData.forEach(({ dappId }) => {
                this.#domainsBlacklistedStatus.set(dappId, 'FAILED_TO_GET');
            });
            throw new Error(`Failed to fetch domains blacklisted data (status: ${res.status}, url: ${res.url})`);
        }
        const domainsBlacklistedStatus = await res.json();
        dappsToFetch.forEach(({ dappId }) => {
            this.#domainsBlacklistedStatus.set(dappId, !domainsBlacklistedStatus || domainsBlacklistedStatus[dappId] === undefined
                ? 'FAILED_TO_GET'
                : domainsBlacklistedStatus[dappId]
                    ? 'BLACKLISTED'
                    : 'VERIFIED');
        });
        !!callback &&
            callback(Object.fromEntries(dappsData.map(({ dappId }) => [dappId, this.#domainsBlacklistedStatus.get(dappId)])));
        this.emitUpdate();
    }
    async #fetchAndSetAddressesBlacklistedStatus(addresses, callback) {
        await this.initialLoadPromise;
        // only unique addresses
        addresses = [...new Set(addresses)];
        if (!addresses.length)
            return;
        const addressesInAccounts = addresses.filter((addr) => {
            if (this.#addressBook.contacts.find((c) => c.isWalletAccount && c.address === addr)) {
                return true;
            }
            return false;
        });
        addresses.forEach((addr) => {
            const status = this.#addresses.size
                ? this.#addresses.has(addr)
                    ? 'BLACKLISTED'
                    : 'VERIFIED'
                : undefined;
            if (status)
                this.#addressesBlacklistedStatus.set(addr, status);
        });
        // always return verified for the added accounts
        addressesInAccounts.forEach((addr) => {
            this.#addressesBlacklistedStatus.set(addr, 'VERIFIED');
        });
        // always return verified for the zero address
        if (addresses.includes(zeroAddress)) {
            this.#addressesBlacklistedStatus.set(zeroAddress, 'VERIFIED');
        }
        if (process.env.IS_TESTING === 'true') {
            addresses.forEach((addr) => {
                this.#addressesBlacklistedStatus.set(addr, this.#addressesBlacklistedStatus.get(addr) || 'VERIFIED');
            });
            !!callback &&
                callback(Object.fromEntries(addresses.map((addr) => [addr, this.#addressesBlacklistedStatus.get(addr)])));
            this.emitUpdate();
            return;
        }
        // Filter: we only fetch for ones that are missing or stale
        const addressesToFetch = addresses.filter((addr) => {
            const status = this.#addressesBlacklistedStatus.get(addr);
            if (!status)
                return true;
            if (['FAILED_TO_GET', 'LOADING'].includes(status))
                return true;
            return false;
        });
        // Mark only the ones we will fetch as LOADING
        addressesToFetch.forEach((addr) => {
            this.#addressesBlacklistedStatus.set(addr, 'LOADING');
        });
        !!callback &&
            callback(Object.fromEntries(addresses.map((addr) => [addr, this.#addressesBlacklistedStatus.get(addr)])));
        this.emitUpdate();
        if (!addressesToFetch.length)
            return; // there will be addressesToFetch only if this.#addresses is still empty
        const res = await fetchWithTimeout(this.#fetch, `${SCAMCHECKER_BASE_URL}/addresses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ addresses: addressesToFetch })
        }, 5000);
        if (!res.ok || res.status !== 200) {
            addressesToFetch.forEach((addr) => {
                this.#addressesBlacklistedStatus.set(addr, 'FAILED_TO_GET');
            });
            throw new Error(`Failed to fetch addresses blacklisted data (status: ${res.status}, url: ${res.url})`);
        }
        const addressesBlacklistedStatus = await res.json();
        addressesToFetch.forEach((addr) => {
            this.#addressesBlacklistedStatus.set(addr, !addressesBlacklistedStatus || addressesBlacklistedStatus[addr] === undefined
                ? 'FAILED_TO_GET'
                : addressesBlacklistedStatus[addr]
                    ? 'BLACKLISTED'
                    : 'VERIFIED');
        });
        !!callback &&
            callback(Object.fromEntries(addresses.map((addr) => [addr, this.#addressesBlacklistedStatus.get(addr)])));
        this.emitUpdate();
    }
    async updateDomainsBlacklistedStatus(urls, callback) {
        try {
            await this.#fetchAndSetDomainsBlacklistedStatus(urls, callback);
        }
        catch (err) {
            this.emitError({
                message: 'Failed to fetch and update domains blacklisted status',
                error: err,
                level: 'silent'
            });
        }
    }
    async updateAddressesBlacklistedStatus(urls, callback) {
        try {
            await this.#fetchAndSetAddressesBlacklistedStatus(urls, callback);
        }
        catch (err) {
            this.emitError({
                message: 'Failed to fetch and update addresses blacklisted status',
                error: err,
                level: 'silent'
            });
        }
    }
    getDomainBlacklistedStatus(url) {
        const dappId = getDappIdFromUrl(url);
        if (!dappId)
            return undefined;
        if (!this.#domains.size)
            return undefined;
        if (this.#domains.has(dappId) || this.#domains.has(getDomain(dappId))) {
            return 'BLACKLISTED';
        }
        return 'VERIFIED';
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            updatePhishingInterval: this.updatePhishingInterval
        };
    }
}
//# sourceMappingURL=phishing.js.map